import { createHash } from "node:crypto";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { constants, createReadStream } from "node:fs";
import { access, lstat, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, posix, win32 } from "node:path";
import { z } from "zod";
import type {
  OmpIntegrityCheck,
  OmpVersionCheck,
  OmpVersionCheckCode,
  RpcMode,
  RpcStatus,
  RuntimeSnapshot,
} from "../shared/contracts";

const lockSchema = z.object({
  package: z.literal("@oh-my-pi/pi-coding-agent"),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  cliVersion: z.string(),
  preferredRpcMode: z.literal("rpc-ui"),
  fallbackRpcMode: z.literal("rpc"),
  protocolVersion: z.literal(2),
  installers: z.record(z.string(), z.object({
    url: z.string().url().startsWith("https://raw.githubusercontent.com/can1357/oh-my-pi/"),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })),
  assets: z.record(z.string(), z.object({
    url: z.string().url().startsWith("https://github.com/can1357/oh-my-pi/releases/download/"),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })).default({}),
});

export type OmpLock = z.infer<typeof lockSchema>;

export interface RuntimeOptions {
  versionTimeoutMs?: number;
  probeTimeoutMs?: number;
  probeRpc?: boolean;
  env?: NodeJS.ProcessEnv;
  managedExecutable?: string | null;
  platform?: NodeJS.Platform;
  arch?: string;
  home?: string;
}

export interface OmpCandidateOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  home?: string;
}

interface CommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  errorCode: string | null;
}

interface CandidateSelection {
  path: string | null;
  inaccessiblePath: string | null;
}

const OUTPUT_LIMIT = 32 * 1024;
const FRAME_LIMIT = 1024 * 1024;
export const OMP_RPC_START_TIMEOUT_MS = 45_000;

export async function loadOmpLock(appRoot: string): Promise<OmpLock> {
  const raw = await readFile(join(appRoot, "omp.lock.json"), "utf8");
  return lockSchema.parse(JSON.parse(raw));
}

export function parseOmpVersion(output: string): string | null {
  for (const rawLine of output.replace(/\r\n?/g, "\n").split("\n")) {
    const match = rawLine.trim().match(/^(?:omp\/|omp\s+)?(\d+\.\d+\.\d+)$/i);
    if (match) return match[1];
  }
  return null;
}

export function ompCandidatePaths(options: OmpCandidateOptions = {}): string[] {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const home = options.home ?? homedir();
  const pathApi = platform === "win32" ? win32 : posix;
  const executableName = platform === "win32" ? "omp.exe" : "omp";
  const pathEntries = (env.PATH ?? "").split(platform === "win32" ? ";" : ":").filter(Boolean);
  const candidates = platform === "win32"
    ? [
        pathApi.join(env.LOCALAPPDATA || pathApi.join(home, "AppData", "Local"), "omp", executableName),
        ...pathEntries.map((directory) => pathApi.join(directory, executableName)),
      ]
    : [
        pathApi.join(home, ".local", "bin", executableName),
        pathApi.join(home, ".bun", "bin", executableName),
        ...pathEntries.map((directory) => pathApi.join(directory, executableName)),
      ];
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = platform === "win32" ? candidate.toLowerCase() : candidate;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function findOmpExecutable(
  override?: string | null,
  env: NodeJS.ProcessEnv = process.env,
  managedExecutable?: string | null,
  options: Pick<RuntimeOptions, "platform" | "home"> = {},
): Promise<string | null> {
  const platform = options.platform ?? process.platform;
  if (override) return (await executableAccessCode(override, platform)) === "ok" ? override : null;
  if (managedExecutable && (await executableAccessCode(managedExecutable, platform)) === "ok") return managedExecutable;
  return (await selectCandidate(ompCandidatePaths({ env, platform, home: options.home }), platform)).path;
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

export async function checkOmpIntegrity(path: string | null, expectedSha256: string | null): Promise<OmpIntegrityCheck> {
  if (!path) {
    return { checked: true, ok: false, path: null, expectedSha256, actualSha256: null, detail: "Управляемый OMP отсутствует" };
  }
  if (!expectedSha256) {
    return { checked: true, ok: false, path, expectedSha256: null, actualSha256: null, detail: `Для управляемого OMP ${path} не задан ожидаемый SHA-256` };
  }
  try {
    const actualSha256 = await sha256File(path);
    const ok = actualSha256 === expectedSha256;
    return {
      checked: true,
      ok,
      path,
      expectedSha256,
      actualSha256,
      detail: ok
        ? `SHA-256 управляемого OMP подтверждён: ${actualSha256}`
        : `SHA-256 управляемого OMP ${path} не совпадает: найден ${actualSha256}, ожидается ${expectedSha256}`,
    };
  } catch (error) {
    const code = nodeErrorCode(error);
    return {
      checked: true,
      ok: false,
      path,
      expectedSha256,
      actualSha256: null,
      detail: `Не удалось вычислить SHA-256 управляемого OMP ${path}: ${code ?? messageOf(error)}`,
    };
  }
}

export async function checkOmpVersion(
  path: string,
  cwd: string,
  expectedVersion: string,
  timeoutMs = 5_000,
  env: NodeJS.ProcessEnv = process.env,
  expectedCliVersion?: string,
): Promise<OmpVersionCheck> {
  const result = await runCommand(path, ["--version"], cwd, timeoutMs, env);
  const output = `${result.stdout}\n${result.stderr}`;
  const foundVersion = parseOmpVersion(output);
  if (result.timedOut) return versionFailure("timeout", path, expectedVersion, foundVersion, result.exitCode, `Проверка версии OMP по пути ${path} превысила timeout ${timeoutMs} мс; ожидается ${expectedVersion}`);
  if (result.errorCode === "ENOENT") return versionFailure("ENOENT", path, expectedVersion, foundVersion, result.exitCode, `OMP не найден по пути ${path}; ожидается версия ${expectedVersion}`);
  if (result.errorCode === "EACCES") return versionFailure("EACCES", path, expectedVersion, foundVersion, result.exitCode, `Нет права выполнить OMP по пути ${path} (EACCES); ожидается версия ${expectedVersion}`);
  if (result.errorCode) return versionFailure("spawn-error", path, expectedVersion, foundVersion, result.exitCode, `Не удалось запустить OMP по пути ${path}: ${result.errorCode}; ожидается версия ${expectedVersion}`);
  if (!foundVersion) {
    const observed = compactOutput(`${result.stdout}\n${result.stderr}`) || "пустой вывод";
    return versionFailure("unknown-format", path, expectedVersion, null, result.exitCode, `Неизвестный формат omp --version по пути ${path}: ${observed}; ожидается ${expectedVersion}`);
  }
  if (result.exitCode !== 0) {
    return versionFailure("nonzero-exit", path, expectedVersion, foundVersion, result.exitCode, `OMP ${path} сообщил версию ${foundVersion}, но omp --version завершился с кодом ${result.exitCode}; ожидается ${expectedVersion}`);
  }
  if (expectedCliVersion && compactOutput(output) !== expectedCliVersion) {
    return versionFailure("unknown-format", path, expectedVersion, foundVersion, result.exitCode, `OMP по пути ${path} вернул ${compactOutput(output) || "пустой вывод"}; ожидается точный вывод ${expectedCliVersion}`);
  }
  if (foundVersion !== expectedVersion) return versionFailure("version-mismatch", path, expectedVersion, foundVersion, result.exitCode, `Несовместимый OMP по пути ${path}: найден ${foundVersion}, ожидается ${expectedVersion}`);
  return {
    ok: true,
    code: "ok",
    path,
    expectedVersion,
    foundVersion,
    exitCode: result.exitCode,
    detail: `OMP ${foundVersion} подтверждён по пути ${path}`,
  };
}

function runCommand(executable: string, args: string[], cwd: string, timeoutMs: number, env: NodeJS.ProcessEnv): Promise<CommandResult> {
  return new Promise((resolve) => {
    let timedOut = false;
    let settled = false;
    let child: ChildProcess | null = null;
    let timeout: NodeJS.Timeout | undefined;
    const finish = (result: CommandResult) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolve(result);
    };
    try {
      child = execFile(executable, args, {
        cwd,
        env,
        encoding: "utf8",
        maxBuffer: OUTPUT_LIMIT,
        windowsHide: true,
      }, (error, stdout, stderr) => {
        const code = error && typeof (error as NodeJS.ErrnoException).code === "string"
          ? String((error as NodeJS.ErrnoException).code)
          : null;
        const numericCode = error && typeof (error as NodeJS.ErrnoException).code === "number"
          ? Number((error as NodeJS.ErrnoException).code)
          : child?.exitCode ?? null;
        finish({
          exitCode: numericCode,
          stdout: String(stdout ?? "").slice(-OUTPUT_LIMIT),
          stderr: String(stderr ?? "").slice(-OUTPUT_LIMIT),
          timedOut,
          errorCode: timedOut ? null : code,
        });
      });
    } catch (error) {
      finish({ exitCode: null, stdout: "", stderr: messageOf(error), timedOut: false, errorCode: nodeErrorCode(error) ?? "spawn-error" });
      return;
    }
    timeout = setTimeout(() => {
      timedOut = true;
      child?.kill("SIGTERM");
      const killTimer = setTimeout(() => { if (child?.exitCode === null) child.kill("SIGKILL"); }, 500);
      killTimer.unref();
    }, timeoutMs);
    timeout.unref();
  });
}

function failedRpc(
  detail: string,
  failureStage: NonNullable<RpcStatus["failureStage"]>,
  attemptedMode?: RpcMode,
  errorCode?: string,
): RpcStatus {
  return {
    ready: false,
    mode: null,
    protocolVersion: null,
    supportedProtocolVersions: [],
    detail,
    failureStage,
    ...(attemptedMode ? { attemptedMode } : {}),
    ...(errorCode ? { errorCode } : {}),
  };
}

export function probeRpc(
  executable: string,
  cwd: string,
  mode: RpcMode,
  timeoutMs = OMP_RPC_START_TIMEOUT_MS,
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
    let child: ChildProcess;
    try {
      child = spawn(executable, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    } catch (error) {
      resolve(failedRpc(`Не удалось запустить OMP RPC ${mode}: ${messageOf(error)}`, "runtime", mode, nodeErrorCode(error) ?? "spawn-error"));
      return;
    }
    let buffer = "";
    let stderr = "";
    let settled = false;
    let sawReady = false;
    let supported: number[] = [];
    let timeout: NodeJS.Timeout | undefined;

    child.stdin?.on("error", () => undefined);
    const finish = (status: RpcStatus) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (child.stdin && !child.stdin.destroyed) child.stdin.end();
      if (child.exitCode === null) {
        const killTimer = setTimeout(() => child.kill("SIGTERM"), 250);
        killTimer.unref();
      }
      resolve(status);
    };

    const handleFrame = (frame: Record<string, unknown>) => {
      if (frame.type === "ready") {
        sawReady = true;
        supported = Array.isArray(frame.supportedProtocolVersions)
          ? frame.supportedProtocolVersions.filter((value): value is number => Number.isSafeInteger(value))
          : [];
        if (!supported.includes(2)) {
          finish({ ...failedRpc(`OMP ${mode} готов, но protocol v2 не поддерживается`, "protocol", mode, "protocol-v2-unsupported"), supportedProtocolVersions: supported });
          return;
        }
        if (!child.stdin) {
          finish(failedRpc(`OMP ${mode} не предоставил stdin для protocol v2 negotiation`, "protocol", mode, "stdin-unavailable"));
          return;
        }
        child.stdin.write(`${JSON.stringify({ id: "mahiko-probe", type: "negotiate_protocol", protocolVersion: 2 })}\n`);
        return;
      }
      if (frame.type === "response" && frame.id === "mahiko-probe") {
        const data = typeof frame.data === "object" && frame.data !== null ? frame.data as Record<string, unknown> : null;
        if (frame.success === true && frame.command === "negotiate_protocol" && data?.protocolVersion === 2) {
          finish({ ready: true, mode, protocolVersion: 2, supportedProtocolVersions: supported, detail: `OMP RPC готов: mode=${mode}, protocol=2` });
        } else {
          finish({ ...failedRpc(`OMP ${mode} не подтвердил protocol v2`, "protocol", mode, "protocol-v2-negotiation"), supportedProtocolVersions: supported });
        }
      }
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      if (Buffer.byteLength(buffer, "utf8") > FRAME_LIMIT) {
        finish(failedRpc("RPC readiness frame превысил 1 MiB", "protocol", mode, "frame-too-large"));
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
          finish(failedRpc("OMP вернул malformed RPC frame до завершения readiness", "protocol", mode, "malformed-frame"));
          return;
        }
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-2_000);
    });
    child.once("error", (error) => {
      const code = nodeErrorCode(error) ?? "spawn-error";
      finish(failedRpc(`Не удалось запустить OMP RPC ${mode}: ${code}: ${error.message}`, "runtime", mode, code));
    });
    child.once("close", (exitCode) => {
      if (settled) return;
      const observed = compactOutput(stderr);
      if (sawReady) {
        finish({ ...failedRpc(`OMP ${mode} завершился до подтверждения protocol v2${observed ? `: ${observed}` : ""}`, "protocol", mode, "protocol-exit"), supportedProtocolVersions: supported });
        return;
      }
      if (observed) {
        const unsupported = /(?:unknown|invalid|unsupported).*(?:rpc-ui|mode)|(?:rpc-ui).*(?:unknown|invalid|unsupported)/i.test(observed);
        finish(failedRpc(`OMP ${mode} завершился с кодом ${exitCode ?? "unknown"}: ${observed}`, unsupported ? "readiness" : "runtime", mode, unsupported ? "unsupported-mode" : "runtime-exit"));
        return;
      }
      finish(failedRpc(`OMP ${mode} exited before RPC readiness (код ${exitCode ?? "unknown"})`, "readiness", mode, "exited-before-ready"));
    });

    timeout = setTimeout(() => {
      finish(failedRpc(
        sawReady ? `OMP ${mode} protocol v2 negotiation timed out after ${timeoutMs} ms` : `OMP ${mode} RPC readiness timed out after ${timeoutMs} ms`,
        sawReady ? "protocol" : "readiness",
        mode,
        sawReady ? "protocol-timeout" : "readiness-timeout",
      ));
    }, timeoutMs);
    timeout.unref();
  });
}

export async function discoverRuntime(
  cwd: string,
  lock: OmpLock,
  override: string | null = null,
  options: RuntimeOptions = {},
): Promise<RuntimeSnapshot> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const home = options.home ?? homedir();
  const expectedSha256 = lock.assets?.[`${platform}-${arch}`]?.sha256 ?? null;
  let executable: string | null = null;
  let versionCheck: OmpVersionCheck;
  let integrity: OmpIntegrityCheck;

  const managedPath = options.managedExecutable ?? null;
  if (override) {
    const managedOverride = managedPath !== null && pathsEqual(override, managedPath, platform);
    versionCheck = await checkOmpVersion(override, cwd, lock.version, options.versionTimeoutMs ?? 5_000, env, managedOverride ? lock.cliVersion : undefined);
    executable = versionCheck.code === "ENOENT" ? null : override;
    integrity = managedOverride ? await checkOmpIntegrity(override, expectedSha256) : uncheckedIntegrity(override);
  } else {
    const managedVersion = managedPath
      ? await checkOmpVersion(managedPath, cwd, lock.version, options.versionTimeoutMs ?? 5_000, env, lock.cliVersion)
      : null;
    const managedIntegrity = managedPath
      ? await checkOmpIntegrity(managedPath, expectedSha256)
      : null;
    if (managedPath && managedVersion?.ok && managedIntegrity?.ok) {
      executable = managedPath;
      versionCheck = managedVersion;
      integrity = managedIntegrity;
    } else {
      const candidates = ompCandidatePaths({ env, platform, home });
      const selected = await selectCandidate(candidates, platform);
      if (selected.path || selected.inaccessiblePath) {
        const selectedPath = selected.path ?? selected.inaccessiblePath!;
        executable = selected.path;
        versionCheck = await checkOmpVersion(selectedPath, cwd, lock.version, options.versionTimeoutMs ?? 5_000, env);
        integrity = uncheckedIntegrity(selectedPath);
      } else if (managedPath && managedVersion && managedIntegrity) {
        executable = managedVersion.code === "ENOENT" ? null : managedPath;
        versionCheck = managedVersion;
        integrity = managedIntegrity;
      } else {
        const expectedPath = candidates[0] ?? (platform === "win32" ? "omp.exe" : "omp");
        versionCheck = versionFailure("ENOENT", expectedPath, lock.version, null, null, `OMP не найден: проверены ${candidates.join(", ") || expectedPath}; ожидается версия ${lock.version}`);
        integrity = uncheckedIntegrity(null);
      }
    }
  }

  const available = versionCheck.code !== "ENOENT" && versionCheck.code !== "EACCES" && versionCheck.code !== "spawn-error";
  const compatible = versionCheck.ok && integrity.ok !== false;
  const base = {
    checkedAt: new Date().toISOString(),
    executable,
    expectedVersion: lock.version,
    version: versionCheck.foundVersion,
    available,
    compatible,
    versionCheck,
    integrity,
  };
  if (!versionCheck.ok) return { ...base, rpc: failedRpc(`RPC не запускался: ${versionCheck.detail}`, "version") };
  if (integrity.ok === false) return { ...base, rpc: failedRpc(`RPC не запускался: ${integrity.detail}`, "integrity") };
  if (!executable) return { ...base, rpc: failedRpc("RPC не запускался: путь OMP отсутствует", "discovery") };
  if (options.probeRpc === false) {
    return { ...base, rpc: failedRpc("RPC readiness не проверялась на этапе настройки провайдера", "readiness", undefined, "not-probed") };
  }

  const probeTimeoutMs = options.probeTimeoutMs ?? OMP_RPC_START_TIMEOUT_MS;
  let rpc = await probeRpc(executable, cwd, lock.preferredRpcMode, probeTimeoutMs, env);
  if (!rpc.ready && isFallbackEligible(rpc)) rpc = await probeRpc(executable, cwd, lock.fallbackRpcMode, probeTimeoutMs, env);
  return { ...base, rpc };
}

async function selectCandidate(candidates: string[], platform: NodeJS.Platform): Promise<CandidateSelection> {
  let inaccessiblePath: string | null = null;
  for (const candidate of candidates) {
    const code = await executableAccessCode(candidate, platform);
    if (code === "ok") return { path: candidate, inaccessiblePath };
    if (code === "EACCES" && !inaccessiblePath) inaccessiblePath = candidate;
  }
  return { path: null, inaccessiblePath };
}

async function executableAccessCode(path: string, platform: NodeJS.Platform): Promise<"ok" | "ENOENT" | "EACCES"> {
  try {
    const link = await lstat(path);
    if (!link.isFile() && !link.isSymbolicLink()) return "EACCES";
    const target = await stat(path);
    if (!target.isFile()) return "EACCES";
    await access(path, platform === "win32" ? constants.F_OK : constants.X_OK);
    return "ok";
  } catch (error) {
    return nodeErrorCode(error) === "EACCES" ? "EACCES" : "ENOENT";
  }
}

function versionFailure(
  code: Exclude<OmpVersionCheckCode, "ok">,
  path: string,
  expectedVersion: string,
  foundVersion: string | null,
  exitCode: number | null,
  detail: string,
): OmpVersionCheck {
  return { ok: false, code, path, expectedVersion, foundVersion, exitCode, detail };
}

function uncheckedIntegrity(path: string | null): OmpIntegrityCheck {
  return { checked: false, ok: null, path, expectedSha256: null, actualSha256: null, detail: "SHA-256 применяется только к загруженному Mahiko OMP" };
}

function pathsEqual(left: string, right: string, platform: NodeJS.Platform): boolean {
  const pathApi = platform === "win32" ? win32 : posix;
  const normalizedLeft = pathApi.resolve(left);
  const normalizedRight = pathApi.resolve(right);
  return platform === "win32" ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase() : normalizedLeft === normalizedRight;
}

function isFallbackEligible(status: RpcStatus): boolean {
  return status.failureStage === "readiness" && ["readiness-timeout", "exited-before-ready", "unsupported-mode"].includes(status.errorCode ?? "");
}

function compactOutput(value: string): string {
  return value.replace(/\r\n?/g, "\n").split("\n").map((line) => line.trim()).filter(Boolean).join(" | ").slice(-2_000);
}

function nodeErrorCode(error: unknown): string | null {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : null;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
