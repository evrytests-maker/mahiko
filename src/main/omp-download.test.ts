import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runOfficialOmpInstaller } from "./omp-installation";
import { checkOmpVersion, sha256File } from "./omp-runtime";

const directories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "mahiko-omp-installer-test-"));
  directories.push(directory);
  return directory;
}

function officialFixture(version = "17.2.9"): Buffer {
  return Buffer.from(`#!/usr/bin/env node\nrequire("node:fs").writeSync(1, "omp/${version}\\n");\n`, "utf8");
}

function streamedResponse(payload: Buffer): Response {
  const middle = Math.floor(payload.length / 2);
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(payload.subarray(0, middle));
      setImmediate(() => {
        controller.enqueue(payload.subarray(middle));
        controller.close();
      });
    },
  }), { status: 200 });
}

function fetchFixture(payload: Buffer): typeof fetch {
  return (async () => streamedResponse(payload)) as typeof fetch;
}

function options(root: string, installer: Buffer, executable = officialFixture()) {
  const targetPath = join(root, "home", ".local", "bin", "omp");
  return {
    assetUrl: "https://example.test/omp-linux-x64",
    installerUrl: "https://example.test/install.sh",
    targetPath,
    expectedVersion: "17.2.9",
    expectedCliVersion: "omp/17.2.9",
    expectedSha256: createHash("sha256").update(executable).digest("hex"),
    expectedInstallerSha256: createHash("sha256").update(installer).digest("hex"),
    platform: "linux" as const,
    env: { PATH: dirname(process.execPath) },
    timeoutMs: 1_000,
    fetchImpl: fetchFixture(installer),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("official OMP installer execution", () => {
  it("streams and verifies the pinned installer, then executes it for v17.2.9", async () => {
    const root = temporaryDirectory();
    const installer = Buffer.from("#!/bin/sh\n# official installer fixture\n", "utf8");
    const executable = officialFixture();
    const installerRunner = vi.fn(async ({ targetPath }: { targetPath: string }) => {
      mkdirSync(dirname(targetPath), { recursive: true });
      writeFileSync(targetPath, executable, { mode: 0o755 });
      chmodSync(targetPath, 0o755);
    });
    const input = { ...options(root, installer, executable), installerRunner };

    const result = await runOfficialOmpInstaller(input);

    expect(installerRunner).toHaveBeenCalledWith(expect.objectContaining({
      platform: "linux",
      targetPath: input.targetPath,
      versionRef: "v17.2.9",
      timeoutMs: 1_000,
    }));
    expect(result.path).toBe(input.targetPath);
    await expect(sha256File(input.targetPath)).resolves.toBe(input.expectedSha256);
    await expect(checkOmpVersion(input.targetPath, root, "17.2.9", 1_000, input.env, "omp/17.2.9"))
      .resolves.toMatchObject({ ok: true });
    expect(statSync(input.targetPath).mode & 0o111).not.toBe(0);
  });

  it("rejects an installer-script checksum mismatch before execution", async () => {
    const root = temporaryDirectory();
    const installer = Buffer.from("unexpected installer", "utf8");
    const installerRunner = vi.fn();
    const input = {
      ...options(root, installer),
      expectedInstallerSha256: "0".repeat(64),
      installerRunner,
    };

    await expect(runOfficialOmpInstaller(input)).rejects.toThrow(/SHA-256.*installer/i);

    expect(installerRunner).not.toHaveBeenCalled();
    expect(existsSync(input.targetPath)).toBe(false);
  });

  it("rejects an installed asset checksum mismatch and restores the working CLI", async () => {
    const root = temporaryDirectory();
    const installer = Buffer.from("installer", "utf8");
    const oldPayload = officialFixture("17.2.8");
    const input = options(root, installer);
    mkdirSync(dirname(input.targetPath), { recursive: true });
    writeFileSync(input.targetPath, oldPayload, { mode: 0o755 });
    const installerRunner = async ({ targetPath }: { targetPath: string }) => {
      writeFileSync(targetPath, officialFixture(), { mode: 0o755 });
      chmodSync(targetPath, 0o755);
    };

    await expect(runOfficialOmpInstaller({ ...input, expectedSha256: "0".repeat(64), installerRunner }))
      .rejects.toThrow(/SHA-256.*OMP/i);

    expect(readFileSync(input.targetPath)).toEqual(oldPayload);
  });

  it("reports installer timeout and restores the working CLI", async () => {
    const root = temporaryDirectory();
    const installer = Buffer.from("installer", "utf8");
    const oldPayload = officialFixture("17.2.8");
    const input = options(root, installer);
    mkdirSync(dirname(input.targetPath), { recursive: true });
    writeFileSync(input.targetPath, oldPayload, { mode: 0o755 });
    const installerRunner = async () => { throw new Error("Официальный installer превысил timeout 25 мс"); };

    await expect(runOfficialOmpInstaller({ ...input, timeoutMs: 25, installerRunner }))
      .rejects.toThrow(/timeout 25 мс/i);

    expect(readFileSync(input.targetPath)).toEqual(oldPayload);
  });

  it("terminates a real stalled installer process at the configured timeout", async () => {
    const root = temporaryDirectory();
    const installer = Buffer.from("#!/bin/sh\nsleep 1\n", "utf8");
    const oldPayload = officialFixture("17.2.8");
    const input = { ...options(root, installer), env: { PATH: "/usr/bin:/bin" } };
    mkdirSync(dirname(input.targetPath), { recursive: true });
    writeFileSync(input.targetPath, oldPayload, { mode: 0o755 });

    await expect(runOfficialOmpInstaller({ ...input, timeoutMs: 25 }))
      .rejects.toThrow(/installer.*timeout 25 мс/i);

    expect(readFileSync(input.targetPath)).toEqual(oldPayload);
  });

  it("requires exact omp/17.2.9 output and rolls back a mismatched install", async () => {
    const root = temporaryDirectory();
    const installer = Buffer.from("installer", "utf8");
    const oldPayload = officialFixture("17.2.8");
    const incompatible = officialFixture("17.2.10");
    const input = options(root, installer, incompatible);
    mkdirSync(dirname(input.targetPath), { recursive: true });
    writeFileSync(input.targetPath, oldPayload, { mode: 0o755 });
    const installerRunner = async ({ targetPath }: { targetPath: string }) => {
      writeFileSync(targetPath, incompatible, { mode: 0o755 });
      chmodSync(targetPath, 0o755);
    };

    await expect(runOfficialOmpInstaller({ ...input, installerRunner }))
      .rejects.toThrow(/ожидается точный вывод omp\/17\.2\.9/i);

    expect(readFileSync(input.targetPath)).toEqual(oldPayload);
  });
});
