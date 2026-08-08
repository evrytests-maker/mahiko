import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installBundledOmp, inspectOmpInstallation, isReplaceableOmpPath } from "./omp-installation";
import { sha256File } from "./omp-runtime";

const temporaryDirectories: string[] = [];

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(process.cwd(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function fakeOmp(path: string, version: string, extra = ""): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `#!/usr/bin/env node\nconst fs = require("node:fs");\n${extra}\nfs.writeSync(1, "omp/${version}\\n");\n`, "utf8");
  chmodSync(path, 0o755);
  return path;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("OMP installation inspection", () => {
  it("recognizes a symlink and reports exact bundled version and SHA separately", async () => {
    const root = temporaryDirectory(".mahiko-test-install-");
    const home = join(root, "home");
    const bundled = fakeOmp(join(root, "resources", "omp", "omp"), "17.2.9");
    const oldBinary = fakeOmp(join(root, "old", "omp"), "17.2.8");
    const installed = join(home, ".bun", "bin", "omp");
    mkdirSync(dirname(installed), { recursive: true });
    symlinkSync(oldBinary, installed);
    const expectedSha256 = await sha256File(bundled);

    const snapshot = await inspectOmpInstallation({
      bundledPath: bundled,
      expectedVersion: "17.2.9",
      expectedSha256,
      env: { PATH: dirname(process.execPath) },
      home,
      platform: "linux",
    });

    expect(snapshot.bundledVersionCheck).toMatchObject({ ok: true, foundVersion: "17.2.9" });
    expect(snapshot.bundledIntegrity).toMatchObject({ checked: true, ok: true, actualSha256: expectedSha256 });
    expect(snapshot.installed).toMatchObject({ path: installed, version: "17.2.8", replaceable: true });
    expect(snapshot.detail).toContain(installed);
    expect(snapshot.detail).toContain("17.2.8");
    expect(snapshot.detail).toContain("17.2.9");
  });
});

describe("safe executable-only replacement", () => {
  it("backs up and replaces a broken executable symlink", async () => {
    const root = temporaryDirectory(".mahiko-test-broken-link-");
    const home = join(root, "home");
    const bundled = fakeOmp(join(root, "resources", "omp", "omp"), "17.2.9");
    const installed = join(home, ".local", "bin", "omp");
    mkdirSync(dirname(installed), { recursive: true });
    symlinkSync(join(root, "missing-omp"), installed);

    const snapshot = await installBundledOmp({
      bundledPath: bundled,
      expectedVersion: "17.2.9",
      expectedSha256: await sha256File(bundled),
      env: { PATH: dirname(process.execPath) },
      home,
      platform: "linux",
    });

    expect(snapshot.installed).toMatchObject({ path: installed, version: "17.2.9" });
    expect(lstatSync(installed).isFile()).toBe(true);
  });

  it("replaces one Linux symlink, preserves OMP data and rechecks version plus hash", async () => {
    const root = temporaryDirectory(".mahiko-test-replace-");
    const home = join(root, "home");
    const bundled = fakeOmp(join(root, "resources", "omp", "omp"), "17.2.9");
    const oldBinary = fakeOmp(join(root, "old", "omp"), "17.2.8");
    const installed = join(home, ".bun", "bin", "omp");
    const accountDb = join(home, ".omp", "agent", "agent.db");
    const session = join(home, ".omp", "agent", "sessions", "keep.jsonl");
    mkdirSync(dirname(installed), { recursive: true });
    mkdirSync(dirname(accountDb), { recursive: true });
    mkdirSync(dirname(session), { recursive: true });
    symlinkSync(oldBinary, installed);
    writeFileSync(accountDb, "account-data", "utf8");
    writeFileSync(session, "chat-data", "utf8");
    const expectedSha256 = await sha256File(bundled);

    const snapshot = await installBundledOmp({
      bundledPath: bundled,
      expectedVersion: "17.2.9",
      expectedSha256,
      env: { PATH: dirname(process.execPath) },
      home,
      platform: "linux",
    });

    expect(snapshot.installed).toMatchObject({ path: installed, version: "17.2.9" });
    expect(lstatSync(installed).isSymbolicLink()).toBe(false);
    await expect(sha256File(installed)).resolves.toBe(expectedSha256);
    expect(lstatSync(installed).mode & 0o111).not.toBe(0);
    expect(readFileSync(accountDb, "utf8")).toBe("account-data");
    expect(readFileSync(session, "utf8")).toBe("chat-data");
  });

  it.each([
    ["project .omp", (_root: string, home: string) => join(home, "projects", "demo", ".omp", "bin", "omp"), (_root: string, _home: string) => ({})],
    ["PI_CODING_AGENT_DIR", (_root: string, home: string) => join(home, "agent-data", "bin", "omp"), (_root: string, home: string) => ({ PI_CODING_AGENT_DIR: join(home, "agent-data") })],
    ["XDG data", (_root: string, home: string) => join(home, "xdg-data", "omp", "bin", "omp"), (_root: string, home: string) => ({ XDG_DATA_HOME: join(home, "xdg-data") })],
  ])("refuses a PATH executable inside %s", async (_label, targetFor, envFor) => {
    const root = temporaryDirectory(".mahiko-test-protected-");
    const home = join(root, "home");
    const target = targetFor(root, home);
    const bundled = fakeOmp(join(root, "resources", "omp", "omp"), "17.2.9");
    fakeOmp(target, "17.2.8");
    const env = envFor(root, home);
    const options = {
      bundledPath: bundled,
      expectedVersion: "17.2.9",
      expectedSha256: await sha256File(bundled),
      env: { ...env, PATH: `${dirname(target)}:${dirname(process.execPath)}` },
      home,
      platform: "linux" as const,
    };

    const before = await inspectOmpInstallation(options);
    expect(before.installed).toMatchObject({ path: target, replaceable: false });
    await expect(installBundledOmp(options)).rejects.toThrow(target);
    expect(existsSync(target)).toBe(true);
  });

  it("rejects Linux system paths and Windows Program Files without elevation", () => {
    expect(isReplaceableOmpPath("/usr/local/bin/omp", {}, "/home/alice", "linux")).toBe(false);
    expect(isReplaceableOmpPath("C:\\Program Files\\OMP\\omp.exe", { ProgramFiles: "C:\\Program Files" }, "C:\\Users\\Alice", "win32")).toBe(false);
    expect(isReplaceableOmpPath("C:\\Users\\Alice\\AppData\\Local\\omp\\omp.exe", { LOCALAPPDATA: "C:\\Users\\Alice\\AppData\\Local" }, "C:\\Users\\Alice", "win32")).toBe(true);
  });

  it("rolls back the previous executable when the installed copy fails its version recheck", async () => {
    const root = temporaryDirectory(".mahiko-test-rollback-");
    const home = join(root, "home");
    const target = fakeOmp(join(home, ".local", "bin", "omp"), "17.2.8");
    const original = readFileSync(target);
    const bundled = fakeOmp(join(root, "resources", "omp", "omp"), "17.2.9", `
if (process.argv[1].endsWith(".local/bin/omp")) {
  fs.writeSync(1, "omp/0.0.0\\n");
  process.exit(0);
}
`);
    const options = {
      bundledPath: bundled,
      expectedVersion: "17.2.9",
      expectedSha256: await sha256File(bundled),
      env: { PATH: dirname(process.execPath) },
      home,
      platform: "linux" as const,
    };

    await expect(installBundledOmp(options)).rejects.toThrow(/повторн|version|верси/i);
    expect(readFileSync(target)).toEqual(original);
    expect(existsSync(`${target}.mahiko-backup-${process.pid}`)).toBe(false);
    expect(existsSync(`${target}.mahiko-new-${process.pid}`)).toBe(false);
  });
});
