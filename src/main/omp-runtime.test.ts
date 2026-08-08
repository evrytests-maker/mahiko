import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OmpLock } from "./omp-runtime";
import { discoverRuntime, parseOmpVersion, probeRpc } from "./omp-runtime";

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
  const directory = mkdtempSync(join(tmpdir(), "mahiko-omp-"));
  const executable = join(directory, "omp");
  temporaryDirectories.push(directory);
  writeFileSync(executable, `#!/usr/bin/env node\n${body}\n`, "utf8");
  chmodSync(executable, 0o755);
  return executable;
}

function rpcFixture(version = "17.2.9"): string {
  return `
if (process.argv.includes("--version")) {
  console.log("omp/${version}");
  process.exit(0);
}
const mode = process.argv[process.argv.indexOf("--mode") + 1];
console.log(JSON.stringify({ type: "ready", mode, protocolVersion: 2, supportedProtocolVersions: [1, 2] }));
process.stdin.setEncoding("utf8");
process.stdin.once("data", (data) => {
  const request = JSON.parse(data.trim());
  console.log(JSON.stringify({ type: "response", id: request.id, command: "negotiate_protocol", success: true, data: { protocolVersion: 2, supportedProtocolVersions: [1, 2] } }));
});
setInterval(() => {}, 1000);
`;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("OMP version discovery", () => {
  it("parses the exact CLI version", () => {
    expect(parseOmpVersion("omp/17.2.9\n")).toBe("17.2.9");
  });

  it("accepts the exact locked version", async () => {
    const snapshot = await discoverRuntime(process.cwd(), lock, fakeOmp(rpcFixture()));
    expect(snapshot).toMatchObject({ available: true, compatible: true, version: "17.2.9" });
    expect(snapshot.rpc).toMatchObject({ ready: true, mode: "rpc-ui", protocolVersion: 2 });
  });

  it("reports a missing executable", async () => {
    const snapshot = await discoverRuntime(process.cwd(), lock, "/missing/mahiko-omp");
    expect(snapshot).toMatchObject({ available: false, compatible: false, executable: null });
  });

  it("does not start RPC for an incompatible version", async () => {
    const marker = join(tmpdir(), `mahiko-rpc-marker-${process.pid}-${Date.now()}`);
    const executable = fakeOmp(`
if (process.argv.includes("--version")) {
  console.log("omp/17.2.8");
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

describe("OMP RPC readiness", () => {
  it("negotiates protocol v2 in rpc-ui mode", async () => {
    const status = await probeRpc(fakeOmp(rpcFixture()), process.cwd(), "rpc-ui", 1000);
    expect(status).toMatchObject({ ready: true, mode: "rpc-ui", protocolVersion: 2 });
    expect(status.supportedProtocolVersions).toEqual([1, 2]);
  });

  it("falls back from rpc-ui to rpc", async () => {
    const executable = fakeOmp(`
if (process.argv.includes("--version")) {
  console.log("omp/17.2.9");
  process.exit(0);
}
const mode = process.argv[process.argv.indexOf("--mode") + 1];
if (mode === "rpc-ui") process.exit(2);
console.log(JSON.stringify({ type: "ready", mode, protocolVersion: 2, supportedProtocolVersions: [2] }));
process.stdin.once("data", (data) => {
  const request = JSON.parse(data.toString().trim());
  console.log(JSON.stringify({ type: "response", id: request.id, command: "negotiate_protocol", success: true, data: { protocolVersion: 2, supportedProtocolVersions: [2] } }));
});
setInterval(() => {}, 1000);
`);
    const snapshot = await discoverRuntime(process.cwd(), lock, executable, { probeTimeoutMs: 1000 });
    expect(snapshot.rpc).toMatchObject({ ready: true, mode: "rpc", protocolVersion: 2 });
  });

  it("rejects a malformed frame", async () => {
    const executable = fakeOmp(`
console.log("not-json");
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
