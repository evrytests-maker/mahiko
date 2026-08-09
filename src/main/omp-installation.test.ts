import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installOfficialOmp, officialOmpAsset, officialOmpCliPath, officialOmpInstaller, officialOmpInstallerCommand } from "./omp-installation";

const directories: string[] = [];
const lock = {
  package: "@oh-my-pi/pi-coding-agent" as const,
  version: "17.2.9",
  cliVersion: "omp/17.2.9",
  preferredRpcMode: "rpc-ui" as const,
  fallbackRpcMode: "rpc" as const,
  protocolVersion: 2 as const,
  installers: {
    linux: {
      url: "https://raw.githubusercontent.com/can1357/oh-my-pi/v17.2.9/scripts/install.sh",
      sha256: "1b9a74f608a430977892c972ed071f3fc46bf6d09bbf81c8827a655beaa73df7",
    },
    win32: {
      url: "https://raw.githubusercontent.com/can1357/oh-my-pi/v17.2.9/scripts/install.ps1",
      sha256: "f0006f0cf6ce33dbe2a1a734fb8b8613a3936fb288d53a4d3cc241bf0a8a976e",
    },
  },
  assets: {
    "linux-x64": {
      url: "https://github.com/can1357/oh-my-pi/releases/download/v17.2.9/omp-linux-x64",
      sha256: "4f7aeb33b2f347c11a5ac8c73630e31d02c0a3eef3693468880b9f5e8f02a02b",
    },
    "win32-x64": {
      url: "https://github.com/can1357/oh-my-pi/releases/download/v17.2.9/omp-windows-x64.exe",
      sha256: "dd0c0d3fb123dd458a534d61456b87790a8042769aa20234145fa25e4205f821",
    },
  },
};

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "mahiko-omp-installation-test-"));
  directories.push(directory);
  return directory;
}

function fakeOmp(path: string, version: string): Buffer {
  const payload = Buffer.from(`#!/usr/bin/env node\nrequire("node:fs").writeSync(1, "omp/${version}\\n");\n`, "utf8");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, payload, { mode: 0o755 });
  chmodSync(path, 0o755);
  return payload;
}

function fetchFixture(payload: Buffer): typeof fetch {
  return (async () => new Response(payload, { status: 200 })) as typeof fetch;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("official OMP asset selection", () => {
  it.each([
    ["linux", "omp", lock.assets["linux-x64"]],
    ["win32", "omp.exe", lock.assets["win32-x64"]],
  ] as const)("selects the pinned %s x64 release", (platform, executableName, expected) => {
    expect(officialOmpAsset(lock, platform, "x64")).toEqual({ ...expected, executableName });
  });

  it("uses the official per-user CLI locations on Linux and Windows", () => {
    expect(officialOmpCliPath("linux", "/home/alice", {})).toBe("/home/alice/.local/bin/omp");
    expect(officialOmpCliPath("win32", "C:\\Users\\Alice", { LOCALAPPDATA: "C:\\Users\\Alice\\AppData\\Local" }))
      .toBe("C:\\Users\\Alice\\AppData\\Local\\omp\\omp.exe");
  });

  it("selects the pinned official installer for Linux and Windows", () => {
    expect(officialOmpInstaller(lock, "linux")).toEqual(lock.installers.linux);
    expect(officialOmpInstaller(lock, "win32")).toEqual(lock.installers.win32);
  });

  it.each([
    ["linux", "/tmp/install.sh", "/home/alice/.local/bin/omp", "sh", ["/tmp/install.sh", "--binary", "--ref", "v17.2.9"]],
    ["win32", "C:\\Temp\\install.ps1", "C:\\Users\\Alice\\AppData\\Local\\omp\\omp.exe", "powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", "C:\\Temp\\install.ps1", "-Binary", "-Ref", "v17.2.9"]],
  ] as const)("runs the tagged official %s installer in binary mode", (platform, installerPath, targetPath, command, args) => {
    const invocation = officialOmpInstallerCommand({
      platform,
      installerPath,
      targetPath,
      versionRef: "v17.2.9",
      timeoutMs: 1_000,
      env: { PATH: "fixture" },
      cwd: "/tmp",
      isolatedUserProfile: "/tmp/isolated-profile",
    });

    expect(invocation.command).toBe(command);
    expect(invocation.args).toEqual(args);
    expect(invocation.env.PI_INSTALL_DIR).toBe(platform === "win32" ? "C:\\Users\\Alice\\AppData\\Local\\omp" : "/home/alice/.local/bin");
    expect(invocation.env.USERPROFILE).toBe(platform === "win32" ? "/tmp/isolated-profile" : undefined);
  });
});

describe("official OMP consent action", () => {
  it("uses a compatible PATH executable without downloading or modifying it", async () => {
    const root = temporaryDirectory();
    const home = join(root, "home");
    const externalPath = join(root, "path", "omp");
    const original = fakeOmp(externalPath, "17.2.9");
    const fetchImpl = vi.fn<typeof fetch>();

    const snapshot = await installOfficialOmp({
      assetUrl: lock.assets["linux-x64"].url,
      installerUrl: lock.installers.linux.url,
      expectedInstallerSha256: lock.installers.linux.sha256,
      targetPath: join(home, ".local", "bin", "omp"),
      expectedVersion: lock.version,
      expectedCliVersion: lock.cliVersion,
      expectedSha256: lock.assets["linux-x64"].sha256,
      platform: "linux",
      home,
      env: { PATH: `${dirname(externalPath)}:${dirname(process.execPath)}` },
      fetchImpl,
    });

    expect(snapshot.selectedPath).toBe(externalPath);
    expect(snapshot.external?.versionCheck.ok).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(readFileSync(externalPath)).toEqual(original);
  });

  it("runs the official installer into the CLI location and leaves OMP data untouched", async () => {
    const root = temporaryDirectory();
    const home = join(root, "home");
    const externalPath = join(root, "path", "omp");
    const externalOriginal = fakeOmp(externalPath, "17.2.8");
    const accountDb = join(home, ".omp", "agent", "agent.db");
    mkdirSync(dirname(accountDb), { recursive: true });
    writeFileSync(accountDb, "account-data", "utf8");
    const targetPath = join(home, ".local", "bin", "omp");
    const official = fakeOmp(join(root, "fixture", "omp"), "17.2.9");
    const installer = Buffer.from("#!/bin/sh\n# official installer fixture\n", "utf8");
    const installerRunner = vi.fn(async ({ targetPath: installerTarget }: { targetPath: string }) => {
      mkdirSync(dirname(installerTarget), { recursive: true });
      writeFileSync(installerTarget, official, { mode: 0o755 });
      chmodSync(installerTarget, 0o755);
    });

    const snapshot = await installOfficialOmp({
      assetUrl: lock.assets["linux-x64"].url,
      installerUrl: lock.installers.linux.url,
      expectedInstallerSha256: createHash("sha256").update(installer).digest("hex"),
      targetPath,
      expectedVersion: lock.version,
      expectedCliVersion: lock.cliVersion,
      expectedSha256: createHash("sha256").update(official).digest("hex"),
      platform: "linux",
      home,
      env: { PATH: `${dirname(externalPath)}:${dirname(process.execPath)}` },
      fetchImpl: fetchFixture(installer),
      installerRunner,
    });

    expect(snapshot.selectedPath).toBe(targetPath);
    expect(snapshot.managedReady).toBe(true);
    expect(installerRunner).toHaveBeenCalledWith(expect.objectContaining({
      platform: "linux",
      targetPath,
      versionRef: "v17.2.9",
    }));
    expect(readFileSync(externalPath)).toEqual(externalOriginal);
    expect(readFileSync(accountDb, "utf8")).toBe("account-data");
  });
});
