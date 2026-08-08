import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OmpLock } from "./omp-runtime";
import { discoverRuntime, ompCandidatePaths, parseOmpVersion, probeRpc, sha256File } from "./omp-runtime";

const lock: OmpLock = {
  package: "@oh-my-pi/pi-coding-agent",
  version: "17.2.9",
  cliVersion: "omp/17.2.9",
  preferredRpcMode: "rpc-ui",
  fallbackRpcMode: "rpc",
  protocolVersion: 2,
};

const temporaryDirectories: string[] = [];

function fakeOmp(body: string): string {
  const directory = temporaryDirectory(".mahiko-test-omp-");
  const executable = join(directory, "omp");
  writeFileSync(executable, `#!/usr/bin/env node\nconst __stdio = require("node:fs");\n${body}\n`, "utf8");
  chmodSync(executable, 0o755);
  return executable;
}

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(process.cwd(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function rpcFixture(version = "17.2.9"): string {
  return `
if (process.argv.includes("--version")) {
  __stdio.writeSync(1, "omp/${version}\\n");
  process.exit(0);
}
const mode = process.argv[process.argv.indexOf("--mode") + 1];
__stdio.writeSync(1, JSON.stringify({ type: "ready", mode, protocolVersion: 2, supportedProtocolVersions: [1, 2] }) + "\\n");
const input = Buffer.alloc(4096);
const count = __stdio.readSync(0, input);
const request = JSON.parse(input.subarray(0, count).toString("utf8").trim());
__stdio.writeSync(1, JSON.stringify({ type: "response", id: request.id, command: "negotiate_protocol", success: true, data: { protocolVersion: 2, supportedProtocolVersions: [1, 2] } }) + "\\n");
setInterval(() => {}, 1000);
`;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("OMP version discovery", () => {
  it.each([
    "omp/17.2.9\n",
    "omp 17.2.9\r\n",
    "17.2.9\r\n",
  ])("parses the supported exact CLI version format %j", (output) => {
    expect(parseOmpVersion(output)).toBe("17.2.9");
  });

  it("does not extract a semver from an unknown output format", () => {
    expect(parseOmpVersion("warning: dependency 17.2.9 is installed\n")).toBeNull();
  });

  it("accepts the exact locked version", async () => {
    const executable = fakeOmp(rpcFixture());
    const snapshot = await discoverRuntime(process.cwd(), lock, executable);
    expect(snapshot).toMatchObject({ available: true, compatible: true, version: "17.2.9" });
    expect(snapshot.rpc).toMatchObject({ ready: true, mode: "rpc-ui", protocolVersion: 2 });
  });

  it("reports a missing executable", async () => {
    const snapshot = await discoverRuntime(process.cwd(), lock, "/missing/mahiko-omp");
    expect(snapshot).toMatchObject({ available: false, compatible: false, executable: null });
    expect(snapshot.versionCheck).toMatchObject({ ok: false, code: "ENOENT" });
    expect(snapshot.versionCheck.detail).toContain("/missing/mahiko-omp");
    expect(snapshot.versionCheck.detail).toContain("17.2.9");
  });

  it("reads the version from stderr with Windows CRLF", async () => {
    const executable = fakeOmp(`
if (process.argv.includes("--version")) {
  __stdio.writeSync(2, "omp 17.2.9\\r\\n");
  process.exit(0);
}
${rpcFixture()}
`);
    const snapshot = await discoverRuntime(process.cwd(), lock, executable);
    expect(snapshot.versionCheck).toMatchObject({ ok: true, code: "ok", foundVersion: "17.2.9" });
  });

  it("distinguishes EACCES from a missing executable", async () => {
    const executable = fakeOmp("console.log('omp/17.2.9');");
    chmodSync(executable, 0o644);
    const snapshot = await discoverRuntime(process.cwd(), lock, executable);
    expect(snapshot.versionCheck).toMatchObject({ ok: false, code: "EACCES" });
    expect(snapshot.versionCheck.detail).toContain(executable);
  });

  it("reports a version timeout independently from RPC readiness", async () => {
    const executable = fakeOmp("setInterval(() => {}, 1000);");
    const snapshot = await discoverRuntime(process.cwd(), lock, executable, { versionTimeoutMs: 50 });
    expect(snapshot.versionCheck).toMatchObject({ ok: false, code: "timeout" });
    expect(snapshot.rpc.failureStage).toBe("version");
  });

  it("reports an unknown version format with the path and expected version", async () => {
    const executable = fakeOmp("__stdio.writeSync(1, 'OMP version seventeen\\n');");
    const snapshot = await discoverRuntime(process.cwd(), lock, executable);
    expect(snapshot.versionCheck).toMatchObject({ ok: false, code: "unknown-format", foundVersion: null });
    expect(snapshot.versionCheck.detail).toContain(executable);
    expect(snapshot.versionCheck.detail).toContain("17.2.9");
  });

  it("does not accept a matching version from a failed version command", async () => {
    const executable = fakeOmp("__stdio.writeSync(1, 'omp/17.2.9\\n'); process.exit(7);");
    const snapshot = await discoverRuntime(process.cwd(), lock, executable);
    expect(snapshot.versionCheck).toMatchObject({ ok: false, code: "nonzero-exit", foundVersion: "17.2.9", exitCode: 7 });
    expect(snapshot.compatible).toBe(false);
  });

  it("does not start RPC for an incompatible version", async () => {
    const marker = join(tmpdir(), `mahiko-rpc-marker-${process.pid}-${Date.now()}`);
    const executable = fakeOmp(`
if (process.argv.includes("--version")) {
  __stdio.writeSync(1, "omp/17.2.8\\n");
  process.exit(0);
}
require("node:fs").writeFileSync(${JSON.stringify(marker)}, "started");
`);
    const snapshot = await discoverRuntime(process.cwd(), lock, executable);
    expect(snapshot).toMatchObject({ available: true, compatible: false, version: "17.2.8" });
    expect(snapshot.rpc.ready).toBe(false);
    expect(() => rmSync(marker)).toThrow();
  });
});

describe("OMP candidate and bundled integrity checks", () => {
  it("uses the platform-specific search order", () => {
    expect(ompCandidatePaths({ platform: "linux", home: "/home/alice", env: { PATH: "/opt/bin:/usr/bin" } })).toEqual([
      "/home/alice/.local/bin/omp",
      "/home/alice/.bun/bin/omp",
      "/opt/bin/omp",
      "/usr/bin/omp",
    ]);
    expect(ompCandidatePaths({ platform: "win32", home: "C:\\Users\\Alice", env: { LOCALAPPDATA: "C:\\Users\\Alice\\AppData\\Local", PATH: "C:\\Tools;C:\\Windows" } })).toEqual([
      "C:\\Users\\Alice\\AppData\\Local\\omp\\omp.exe",
      "C:\\Tools\\omp.exe",
      "C:\\Windows\\omp.exe",
    ]);
  });

  it("prefers a checksum-verified bundled OMP over an incompatible PATH executable", async () => {
    const home = temporaryDirectory(".mahiko-test-home-");
    const pathDirectory = join(home, "path-bin");
    mkdirSync(pathDirectory, { recursive: true });
    const incompatible = join(pathDirectory, "omp");
    writeFileSync(incompatible, "#!/usr/bin/env node\nrequire('node:fs').writeSync(1, 'omp/17.2.8\\n');\n", "utf8");
    chmodSync(incompatible, 0o755);
    const bundled = fakeOmp(rpcFixture());
    const bundledHash = createHash("sha256").update(readFileSync(bundled)).digest("hex");
    const pinned = { ...lock, assets: { "linux-x64": { sha256: bundledHash } } };

    const snapshot = await discoverRuntime(process.cwd(), pinned, null, {
      bundledExecutable: bundled,
      env: { PATH: `${pathDirectory}:${dirname(process.execPath)}` },
      home,
      platform: "linux",
      arch: "x64",
      probeTimeoutMs: 1000,
    });

    expect(snapshot.executable).toBe(bundled);
    expect(snapshot.integrity).toMatchObject({ checked: true, ok: true, actualSha256: bundledHash });
    expect(snapshot).toMatchObject({ version: "17.2.9", compatible: true });
  });

  it("keeps a bundled hash failure separate from the exact version result", async () => {
    const bundled = fakeOmp(rpcFixture());
    const pinned = { ...lock, assets: { "linux-x64": { sha256: "0".repeat(64) } } };
    const emptyHome = temporaryDirectory(".mahiko-test-empty-home-");
    const snapshot = await discoverRuntime(process.cwd(), pinned, null, {
      bundledExecutable: bundled,
      env: { PATH: dirname(process.execPath) },
      home: emptyHome,
      platform: "linux",
      arch: "x64",
    });
    expect(snapshot.versionCheck).toMatchObject({ ok: true, foundVersion: "17.2.9" });
    expect(snapshot.integrity).toMatchObject({ checked: true, ok: false, expectedSha256: "0".repeat(64) });
    expect(snapshot.compatible).toBe(false);
    expect(snapshot.rpc.failureStage).toBe("integrity");
  });

  it("computes SHA-256 through the file helper", async () => {
    const executable = fakeOmp("__stdio.writeSync(1, 'omp/17.2.9\\n');");
    const expected = createHash("sha256").update(readFileSync(executable)).digest("hex");
    await expect(sha256File(executable)).resolves.toBe(expected);
  });
});

describe("OMP RPC readiness", () => {
  it("negotiates protocol v2 in rpc-ui mode", async () => {
    const status = await probeRpc(fakeOmp(rpcFixture()), process.cwd(), "rpc-ui", 1000);
    expect(status).toMatchObject({ ready: true, mode: "rpc-ui", protocolVersion: 2 });
    expect(status.supportedProtocolVersions).toEqual([1, 2]);
  });

  it("falls back from rpc-ui to rpc", async () => {
    const executable = fakeOmp(`
if (process.argv.includes("--version")) {
  __stdio.writeSync(1, "omp/17.2.9\\n");
  process.exit(0);
}
const mode = process.argv[process.argv.indexOf("--mode") + 1];
if (mode === "rpc-ui") process.exit(2);
__stdio.writeSync(1, JSON.stringify({ type: "ready", mode, protocolVersion: 2, supportedProtocolVersions: [2] }) + "\\n");
const input = Buffer.alloc(4096);
const count = __stdio.readSync(0, input);
const request = JSON.parse(input.subarray(0, count).toString("utf8").trim());
__stdio.writeSync(1, JSON.stringify({ type: "response", id: request.id, command: "negotiate_protocol", success: true, data: { protocolVersion: 2, supportedProtocolVersions: [2] } }) + "\\n");
setInterval(() => {}, 1000);
`);
    const snapshot = await discoverRuntime(process.cwd(), lock, executable, { probeTimeoutMs: 1000 });
    expect(snapshot.rpc).toMatchObject({ ready: true, mode: "rpc", protocolVersion: 2 });
  });

  it("does not fall back after rpc-ui reaches readiness but fails protocol v2", async () => {
    const marker = join(tmpdir(), `mahiko-rpc-modes-${process.pid}-${Date.now()}`);
    const executable = fakeOmp(`
if (process.argv.includes("--version")) { __stdio.writeSync(1, "omp/17.2.9\\n"); process.exit(0); }
const mode = process.argv[process.argv.indexOf("--mode") + 1];
require("node:fs").appendFileSync(${JSON.stringify(marker)}, mode + "\\n");
if (mode === "rpc") {
  __stdio.writeSync(1, JSON.stringify({ type: "ready", supportedProtocolVersions: [2] }) + "\\n");
  setInterval(() => {}, 1000);
} else {
  __stdio.writeSync(1, JSON.stringify({ type: "ready", protocolVersion: 1, supportedProtocolVersions: [1] }) + "\\n");
  setInterval(() => {}, 1000);
}
`);
    const snapshot = await discoverRuntime(process.cwd(), lock, executable, { probeTimeoutMs: 1000 });
    expect(snapshot).toMatchObject({ compatible: true });
    expect(snapshot.rpc).toMatchObject({ ready: false, failureStage: "protocol", attemptedMode: "rpc-ui" });
    expect(readFileSync(marker, "utf8")).toBe("rpc-ui\n");
    rmSync(marker);
  });

  it("surfaces an rpc-ui runtime/cache error without relabelling the version or falling back", async () => {
    const marker = join(tmpdir(), `mahiko-rpc-runtime-${process.pid}-${Date.now()}`);
    const executable = fakeOmp(`
if (process.argv.includes("--version")) { __stdio.writeSync(1, "omp/17.2.9\\n"); process.exit(0); }
const mode = process.argv[process.argv.indexOf("--mode") + 1];
require("node:fs").appendFileSync(${JSON.stringify(marker)}, mode + "\\n");
if (mode === "rpc-ui") {
  __stdio.writeSync(2, "EACCES: cannot create native cache ~/.omp/natives/17.2.9\\n");
  process.exit(1);
}
__stdio.writeSync(1, JSON.stringify({ type: "ready", supportedProtocolVersions: [2] }) + "\\n");
setInterval(() => {}, 1000);
`);
    const snapshot = await discoverRuntime(process.cwd(), lock, executable, { probeTimeoutMs: 1000 });
    expect(snapshot).toMatchObject({ version: "17.2.9", compatible: true });
    expect(snapshot.versionCheck).toMatchObject({ ok: true, code: "ok" });
    expect(snapshot.rpc).toMatchObject({ ready: false, failureStage: "runtime", attemptedMode: "rpc-ui" });
    expect(snapshot.rpc.detail).toContain("native cache");
    expect(readFileSync(marker, "utf8")).toBe("rpc-ui\n");
    rmSync(marker);
  });

  it("rejects a malformed frame", async () => {
    const executable = fakeOmp(`
__stdio.writeSync(1, "not-json\\n");
setInterval(() => {}, 1000);
`);
    const status = await probeRpc(executable, process.cwd(), "rpc-ui", 1000);
    expect(status).toMatchObject({ ready: false, mode: null });
    expect(status.detail).toMatch(/malformed RPC frame/i);
  });

  it("times out when readiness is never emitted", async () => {
    const status = await probeRpc(fakeOmp("setInterval(() => {}, 1000);"), process.cwd(), "rpc-ui", 50);
    expect(status).toMatchObject({ ready: false, mode: null });
    expect(status.detail).toMatch(/timed out/i);
  });

  it("reports an early process exit", async () => {
    const status = await probeRpc(fakeOmp("process.exit(3);"), process.cwd(), "rpc-ui", 1000);
    expect(status).toMatchObject({ ready: false, mode: null });
    expect(status.detail).toMatch(/exited before RPC readiness/);
  });
});
