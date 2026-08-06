import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { spawn } from "node:child_process";
import { z } from "zod";
import type { RpcMode, RpcStatus, RuntimeSnapshot } from "../shared/contracts";

const lockSchema = z.object({
  package: z.literal("@oh-my-pi/pi-coding-agent"),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  cliVersion: z.string(),
  preferredRpcMode: z.literal("rpc-ui"),
  fallbackRpcMode: z.literal("rpc"),
  protocolVersion: z.literal(2),
});

export type OmpLock = z.infer<typeof lockSchema>;

export interface RuntimeOptions {
  versionTimeoutMs?: number;
  probeTimeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

interface CommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

const OUTPUT_LIMIT = 32 * 1024;
const FRAME_LIMIT = 1024 * 1024;

export async function loadOmpLock(appRoot: string): Promise<OmpLock> {
  const raw = await readFile(join(appRoot, "omp.lock.json"), "utf8");
  return lockSchema.parse(JSON.parse(raw));
}

export function parseOmpVersion(output: string): string | null {
  return output.match(/(?:^|\s)(?:omp\/)?(\d+\.\d+\.\d+)(?:\s|$)/)?.[1] ?? null;
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function findOmpExecutable(override?: string | null, env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  if (override) return (await isExecutable(override)) ? override : null;
  const candidates = [
    ...(env.PATH ?? "").split(delimiter).filter(Boolean).map((directory) => join(directory, "omp")),
    join(homedir(), ".bun", "bin", "omp"),
  ];
  for (const candidate of [...new Set(candidates)]) {
    if (await isExecutable(candidate)) return candidate;
  }
  return null;
}

function runCommand(
  executable: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  env: NodeJS.ProcessEnv,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(executable, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (result: CommandResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = `${stdout}${chunk.toString("utf8")}`.slice(-OUTPUT_LIMIT);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-OUTPUT_LIMIT);
    });
    child.once("error", (error) => finish({ exitCode: null, stdout, stderr: error.message, timedOut: false }));
    child.once("close", (exitCode) => finish({ exitCode, stdout, stderr, timedOut: false }));

    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      finish({ exitCode: null, stdout, stderr, timedOut: true });
    }, timeoutMs);
  });
}

function failedRpc(detail: string): RpcStatus {
  return { ready: false, mode: null, protocolVersion: null, supportedProtocolVersions: [], detail };
}

export function probeRpc(
  executable: string,
  cwd: string,
  mode: RpcMode,
  timeoutMs = 3_000,
  env: NodeJS.ProcessEnv = process.env,
): Promise<RpcStatus> {
  return new Promise((resolve) => {
    const args = [
      "--mode", mode,
      "--cwd", cwd,
      "--allow-home",
      "--no-session",
      "--no-tools",
      "--no-lsp",
      "--no-extensions",
      "--no-skills",
      "--no-rules",
    ];
    const child = spawn(executable, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    let buffer = "";
    let stderr = "";
    let settled = false;
    let supported: number[] = [];

    const finish = (status: RpcStatus) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.stdin.end();
      const killTimer = setTimeout(() => child.kill("SIGTERM"), 250);
      killTimer.unref();
      resolve(status);
    };

    const handleFrame = (frame: Record<string, unknown>) => {
      if (frame.type === "ready") {
        supported = Array.isArray(frame.supportedProtocolVersions)
          ? frame.supportedProtocolVersions.filter((value): value is number => Number.isSafeInteger(value))
          : [];
        if (supported.includes(2)) {
          child.stdin.write(`${JSON.stringify({ id: "mohiko-probe", type: "negotiate_protocol", protocolVersion: 2 })}\n`);
          return;
        }
        const protocol = typeof frame.protocolVersion === "number" ? frame.protocolVersion : 1;
        finish({ ready: true, mode, protocolVersion: protocol, supportedProtocolVersions: supported, detail: "Ready" });
        return;
      }
      if (frame.type === "response" && frame.id === "mohiko-probe") {
        const data = typeof frame.data === "object" && frame.data !== null ? frame.data as Record<string, unknown> : null;
        if (frame.success === true && frame.command === "negotiate_protocol" && data?.protocolVersion === 2) {
          finish({ ready: true, mode, protocolVersion: 2, supportedProtocolVersions: supported, detail: "Ready" });
        } else {
          finish(failedRpc("RPC protocol v2 negotiation failed"));
        }
      }
    };

    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      if (Buffer.byteLength(buffer, "utf8") > FRAME_LIMIT) {
        finish(failedRpc("RPC readiness frame exceeded 1 MiB"));
        return;
      }
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const frame: unknown = JSON.parse(line);
          if (typeof frame !== "object" || frame === null || Array.isArray(frame)) throw new Error("not an object");
          handleFrame(frame as Record<string, unknown>);
        } catch {
          finish(failedRpc("OMP emitted a malformed RPC frame"));
          return;
        }
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-2_000);
    });
    child.once("error", (error) => finish(failedRpc(error.message)));
    child.once("close", () => finish(failedRpc("OMP exited before RPC readiness")));

    const timeout = setTimeout(() => finish(failedRpc("RPC readiness probe timed out")), timeoutMs);
  });
}

export async function discoverRuntime(
  cwd: string,
  lock: OmpLock,
  override: string | null = null,
  options: RuntimeOptions = {},
): Promise<RuntimeSnapshot> {
  const env = options.env ?? process.env;
  const executable = await findOmpExecutable(override, env);
  const base = {
    checkedAt: new Date().toISOString(),
    executable,
    expectedVersion: lock.version,
  };
  if (!executable) {
    return { ...base, version: null, available: false, compatible: false, rpc: failedRpc("OMP executable not found") };
  }

  const versionResult = await runCommand(executable, ["--version"], cwd, options.versionTimeoutMs ?? 3_000, env);
  const version = parseOmpVersion(`${versionResult.stdout}\n${versionResult.stderr}`);
  const available = !versionResult.timedOut && (versionResult.exitCode === 0 || version !== null);
  const compatible = available && version === lock.version;
  if (!compatible) {
    const detail = versionResult.timedOut
      ? "OMP version check timed out"
      : `Expected OMP ${lock.version}, found ${version ?? "unknown"}`;
    return { ...base, version, available, compatible: false, rpc: failedRpc(detail) };
  }

  const probeTimeoutMs = options.probeTimeoutMs ?? 10_000;
  let rpc = await probeRpc(executable, cwd, lock.preferredRpcMode, probeTimeoutMs, env);
  if (!rpc.ready) rpc = await probeRpc(executable, cwd, lock.fallbackRpcMode, probeTimeoutMs, env);
  return { ...base, version, available, compatible, rpc };
}
