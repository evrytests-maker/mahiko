import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, chmod, copyFile, lstat, mkdir, readFile, rename, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import type { OmpInstallation, OmpInstallationSnapshot } from "../shared/contracts";
import { parseOmpVersion } from "./omp-runtime";

const execFileAsync = promisify(execFile);

interface InstallationOptions {
  bundledPath: string | null;
  expectedVersion: string;
  expectedSha256: string;
  env?: NodeJS.ProcessEnv;
  home?: string;
  platform?: NodeJS.Platform;
}

interface Candidate {
  path: string;
  source: OmpInstallation["source"];
}

export async function inspectOmpInstallation(options: InstallationOptions): Promise<OmpInstallationSnapshot> {
  const env = options.env ?? process.env;
  const home = options.home ?? homedir();
  const platform = options.platform ?? process.platform;
  const bundledVersion = options.bundledPath ? await readVersion(options.bundledPath) : null;
  const bundledHash = options.bundledPath ? await sha256(options.bundledPath) : null;
  const bundledReady = bundledVersion === options.expectedVersion && bundledHash === options.expectedSha256;
  const candidates = externalCandidates(env, home, platform);
  let installed: OmpInstallation | null = null;
  for (const candidate of candidates) {
    if (!await isFileLike(candidate.path) || pathsEqual(candidate.path, options.bundledPath, platform)) continue;
    installed = {
      path: candidate.path,
      version: await readVersion(candidate.path),
      source: candidate.source,
      replaceable: isReplaceable(candidate.path, env, home, platform),
    };
    break;
  }
  return {
    checkedAt: new Date().toISOString(),
    expectedVersion: options.expectedVersion,
    bundledPath: options.bundledPath,
    bundledVersion,
    bundledReady,
    installed,
    dataLocations: ompDataLocations(env, home, platform),
    detail: !bundledReady
      ? `Встроенный OMP ${options.expectedVersion} отсутствует или не прошёл проверку целостности`
      : installed
        ? installed.replaceable
          ? `Найден OMP ${installed.version ?? "неизвестной версии"}`
          : "OMP найден в системном каталоге, который Mahiko не имеет права изменять"
        : "Установленный OMP не найден",
  };
}

export async function installBundledOmp(options: InstallationOptions): Promise<OmpInstallationSnapshot> {
  const before = await inspectOmpInstallation(options);
  if (!before.bundledReady || !before.bundledPath) throw new Error(before.detail);
  if (before.installed && !before.installed.replaceable) {
    throw new Error(`Безопасная замена запрещена для ${before.installed.path}. Mahiko никогда не изменяет системные бинарники без пользовательских прав.`);
  }

  const env = options.env ?? process.env;
  const home = options.home ?? homedir();
  const platform = options.platform ?? process.platform;
  const target = before.installed?.path ?? officialInstallPath(env, home, platform);
  if (!isReplaceable(target, env, home, platform)) throw new Error(`Небезопасный путь установки OMP: ${target}`);

  await atomicReplaceExecutable(before.bundledPath, target, options.expectedVersion, platform);
  const after = await inspectOmpInstallation(options);
  if (after.installed?.version !== options.expectedVersion || !pathsEqual(after.installed.path, target, platform)) {
    throw new Error("OMP был скопирован, но повторная проверка установки не подтвердила версию 17.2.9");
  }
  return after;
}

function externalCandidates(env: NodeJS.ProcessEnv, home: string, platform: NodeJS.Platform): Candidate[] {
  const executableName = platform === "win32" ? "omp.exe" : "omp";
  const candidates: Candidate[] = [
    { path: officialInstallPath(env, home, platform), source: "official" },
    { path: join(home, ".bun", "bin", executableName), source: "bun" },
    ...(env.PATH ?? "").split(delimiter).filter(Boolean).map((directory): Candidate => ({ path: join(directory, executableName), source: "path" })),
  ];
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = normalized(candidate.path, platform);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function officialInstallPath(env: NodeJS.ProcessEnv, home: string, platform: NodeJS.Platform): string {
  if (platform === "win32") return join(env.LOCALAPPDATA || join(home, "AppData", "Local"), "omp", "omp.exe");
  return join(home, ".local", "bin", "omp");
}

function isReplaceable(path: string, env: NodeJS.ProcessEnv, home: string, platform: NodeJS.Platform): boolean {
  const name = basename(path).toLowerCase();
  if (name !== "omp" && name !== "omp.exe") return false;
  const dataRoot = join(home, ".omp");
  if (pathWithin(dataRoot, path, platform)) return false;
  const roots = [home];
  if (platform === "win32" && env.LOCALAPPDATA) roots.push(env.LOCALAPPDATA);
  return roots.some((root) => pathWithin(root, path, platform));
}

function ompDataLocations(env: NodeJS.ProcessEnv, home: string, platform: NodeJS.Platform): string[] {
  const locations = [join(home, ".omp")];
  if (env.PI_CODING_AGENT_DIR) locations.push(resolve(env.PI_CODING_AGENT_DIR));
  if (platform === "linux" || platform === "darwin") {
    for (const key of ["XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"] as const) {
      if (env[key]) locations.push(join(env[key], "omp"));
    }
  }
  const seen = new Set<string>();
  return locations.filter((entry) => {
    const key = normalized(entry, platform);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function atomicReplaceExecutable(source: string, target: string, version: string, platform: NodeJS.Platform): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.mahiko-new-${process.pid}`;
  const backup = `${target}.mahiko-backup-${process.pid}`;
  await unlink(temporary).catch(() => undefined);
  await unlink(backup).catch(() => undefined);
  await copyFile(source, temporary, constants.COPYFILE_EXCL);
  if (platform !== "win32") await chmod(temporary, 0o755);
  if (await readVersion(temporary) !== version) {
    await unlink(temporary).catch(() => undefined);
    throw new Error(`Встроенный OMP не подтвердил версию ${version}`);
  }

  const hadTarget = await isFileLike(target);
  try {
    if (hadTarget) await rename(target, backup);
    await rename(temporary, target);
    if (await readVersion(target) !== version) throw new Error(`Установленный OMP не подтвердил версию ${version}`);
    if (hadTarget) await unlink(backup);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    if (hadTarget && await isFileLike(backup)) {
      await unlink(target).catch(() => undefined);
      await rename(backup, target).catch(() => undefined);
    } else if (!hadTarget) {
      await unlink(target).catch(() => undefined);
    }
    throw error;
  }
}

async function readVersion(path: string): Promise<string | null> {
  try {
    const result = await execFileAsync(path, ["--version"], { timeout: 5_000, maxBuffer: 64 * 1024, windowsHide: true });
    return parseOmpVersion(`${result.stdout}\n${result.stderr}`);
  } catch (error) {
    const output = typeof error === "object" && error !== null
      ? `${"stdout" in error ? String(error.stdout ?? "") : ""}\n${"stderr" in error ? String(error.stderr ?? "") : ""}`
      : "";
    return parseOmpVersion(output);
  }
}

async function sha256(path: string): Promise<string | null> {
  try {
    return createHash("sha256").update(await readFile(path)).digest("hex");
  } catch {
    return null;
  }
}

async function isFileLike(path: string): Promise<boolean> {
  try {
    const value = await lstat(path);
    if (!value.isFile() && !value.isSymbolicLink()) return false;
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function pathsEqual(left: string, right: string | null, platform: NodeJS.Platform): boolean {
  return right !== null && normalized(left, platform) === normalized(right, platform);
}

function pathWithin(root: string, candidate: string, platform: NodeJS.Platform): boolean {
  const rootPath = normalized(root, platform);
  const candidatePath = normalized(candidate, platform);
  const segment = relative(rootPath, candidatePath);
  return segment === "" || (!segment.startsWith("..") && !isAbsolute(segment));
}

function normalized(path: string, platform: NodeJS.Platform): string {
  const value = resolve(path);
  return platform === "win32" ? value.toLowerCase() : value;
}
