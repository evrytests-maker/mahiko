import { constants } from "node:fs";
import { chmod, copyFile, lstat, mkdir, rename, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { posix, win32 } from "node:path";
import type { OmpInstallation, OmpInstallationSnapshot } from "../shared/contracts";
import { checkOmpIntegrity, checkOmpVersion } from "./omp-runtime";

export interface InstallationOptions {
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
  const bundledVersionCheck = options.bundledPath
    ? await checkOmpVersion(options.bundledPath, process.cwd(), options.expectedVersion, 5_000, env)
    : null;
  const bundledIntegrity = await checkOmpIntegrity(options.bundledPath, options.expectedSha256);
  const bundledVersion = bundledVersionCheck?.foundVersion ?? null;
  const bundledHash = bundledIntegrity.actualSha256;
  const bundledReady = bundledVersionCheck?.ok === true && bundledIntegrity.ok === true;
  let installed: OmpInstallation | null = null;
  for (const candidate of externalCandidates(env, home, platform)) {
    if (!await isFileLikeEntry(candidate.path) || pathsEqual(candidate.path, options.bundledPath, platform)) continue;
    const versionCheck = await checkOmpVersion(candidate.path, process.cwd(), options.expectedVersion, 5_000, env);
    installed = {
      path: candidate.path,
      version: versionCheck.foundVersion,
      versionCheck,
      source: candidate.source,
      replaceable: isReplaceableOmpPath(candidate.path, env, home, platform),
    };
    break;
  }
  return {
    checkedAt: new Date().toISOString(),
    expectedVersion: options.expectedVersion,
    expectedSha256: options.expectedSha256,
    bundledPath: options.bundledPath,
    bundledVersion,
    bundledSha256: bundledHash,
    bundledVersionCheck,
    bundledIntegrity,
    bundledReady,
    installed,
    dataLocations: ompDataLocations(env, home, platform),
    detail: installationDetail(options, bundledVersionCheck, bundledIntegrity, installed),
  };
}

export async function installBundledOmp(options: InstallationOptions): Promise<OmpInstallationSnapshot> {
  const before = await inspectOmpInstallation(options);
  if (!before.bundledVersionCheck?.ok) throw new Error(before.bundledVersionCheck?.detail ?? `Встроенный OMP ${options.expectedVersion} отсутствует`);
  if (!before.bundledIntegrity.ok || !before.bundledPath) throw new Error(before.bundledIntegrity.detail);
  if (before.installed && !before.installed.replaceable) {
    throw new Error(`Безопасная замена запрещена для ${before.installed.path}: найден ${before.installed.version ?? "unknown"}, ожидается ${options.expectedVersion}. Mahiko не изменяет системные и OMP data-пути.`);
  }

  const env = options.env ?? process.env;
  const home = options.home ?? homedir();
  const platform = options.platform ?? process.platform;
  const target = before.installed?.path ?? officialInstallPath(env, home, platform);
  if (!isReplaceableOmpPath(target, env, home, platform)) throw new Error(`Небезопасный путь установки OMP: ${target}`);

  await atomicReplaceExecutable(before.bundledPath, target, options.expectedVersion, options.expectedSha256, platform, env);
  const after = await inspectOmpInstallation(options);
  if (after.installed?.version !== options.expectedVersion || !pathsEqual(after.installed.path, target, platform)) {
    throw new Error(`OMP скопирован в ${target}, но повторная проверка нашла ${after.installed?.version ?? "unknown"}; ожидается ${options.expectedVersion}`);
  }
  return after;
}

function installationDetail(
  options: InstallationOptions,
  bundledVersionCheck: OmpInstallationSnapshot["bundledVersionCheck"],
  bundledIntegrity: OmpInstallationSnapshot["bundledIntegrity"],
  installed: OmpInstallation | null,
): string {
  if (!bundledVersionCheck?.ok) return bundledVersionCheck?.detail ?? `Встроенный OMP ${options.expectedVersion} отсутствует`;
  if (!bundledIntegrity.ok) return bundledIntegrity.detail;
  if (!installed) return `OMP не найден; ожидается ${options.expectedVersion}. Встроенный OMP проверен по пути ${options.bundledPath}`;
  const version = installed.version ?? "unknown";
  if (!installed.replaceable) return `Найден OMP ${version} по пути ${installed.path}; ожидается ${options.expectedVersion}. Автоматическая замена этого пути запрещена`;
  return `Найден OMP ${version} по пути ${installed.path}; ожидается ${options.expectedVersion}`;
}

function externalCandidates(env: NodeJS.ProcessEnv, home: string, platform: NodeJS.Platform): Candidate[] {
  const pathApi = platform === "win32" ? win32 : posix;
  const executableName = platform === "win32" ? "omp.exe" : "omp";
  const candidates: Candidate[] = platform === "win32"
    ? [
        { path: officialInstallPath(env, home, platform), source: "official" },
        ...(env.PATH ?? "").split(";").filter(Boolean).map((directory): Candidate => ({ path: pathApi.join(directory, executableName), source: "path" })),
      ]
    : [
        { path: officialInstallPath(env, home, platform), source: "official" },
        { path: pathApi.join(home, ".bun", "bin", executableName), source: "bun" },
        ...(env.PATH ?? "").split(":").filter(Boolean).map((directory): Candidate => ({ path: pathApi.join(directory, executableName), source: "path" })),
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
  if (platform === "win32") return win32.join(env.LOCALAPPDATA || win32.join(home, "AppData", "Local"), "omp", "omp.exe");
  return posix.join(home, ".local", "bin", "omp");
}

export function isReplaceableOmpPath(path: string, env: NodeJS.ProcessEnv, home: string, platform: NodeJS.Platform): boolean {
  const pathApi = platform === "win32" ? win32 : posix;
  const name = pathApi.basename(path).toLowerCase();
  if (name !== "omp" && name !== "omp.exe") return false;
  const normalizedPath = normalized(path, platform);
  if (normalizedPath.split(/[\\/]+/).some((segment) => segment.toLowerCase() === ".omp")) return false;

  const protectedRoots = [pathApi.join(home, ".omp")];
  if (env.PI_CODING_AGENT_DIR) protectedRoots.push(pathApi.resolve(env.PI_CODING_AGENT_DIR));
  if (platform !== "win32") {
    for (const key of ["XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"] as const) {
      if (env[key]) protectedRoots.push(pathApi.join(env[key], "omp"));
    }
  }
  if (protectedRoots.some((root) => pathWithin(root, path, platform))) return false;

  if (platform === "win32") {
    for (const key of ["ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"] as const) {
      if (env[key] && pathWithin(env[key], path, platform)) return false;
    }
  } else if (["/usr/bin", "/usr/local/bin"].some((root) => pathWithin(root, path, platform))) {
    return false;
  }

  const allowedRoots = [home];
  if (platform === "win32" && env.LOCALAPPDATA) allowedRoots.push(env.LOCALAPPDATA);
  return allowedRoots.some((root) => pathWithin(root, path, platform));
}

function ompDataLocations(env: NodeJS.ProcessEnv, home: string, platform: NodeJS.Platform): string[] {
  const pathApi = platform === "win32" ? win32 : posix;
  const locations = [pathApi.join(home, ".omp")];
  if (env.PI_CODING_AGENT_DIR) locations.push(pathApi.resolve(env.PI_CODING_AGENT_DIR));
  if (platform !== "win32") {
    for (const key of ["XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"] as const) {
      if (env[key]) locations.push(pathApi.join(env[key], "omp"));
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

async function atomicReplaceExecutable(
  source: string,
  target: string,
  version: string,
  expectedSha256: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const pathApi = platform === "win32" ? win32 : posix;
  await mkdir(pathApi.dirname(target), { recursive: true });
  const temporary = `${target}.mahiko-new-${process.pid}`;
  const backup = `${target}.mahiko-backup-${process.pid}`;
  await unlink(temporary).catch(() => undefined);
  await unlink(backup).catch(() => undefined);
  await copyFile(source, temporary, constants.COPYFILE_EXCL);
  if (platform !== "win32") await chmod(temporary, 0o755);

  const temporaryVersion = await checkOmpVersion(temporary, process.cwd(), version, 5_000, env);
  if (!temporaryVersion.ok) {
    await unlink(temporary).catch(() => undefined);
    throw new Error(`Временный OMP ${temporary} не прошёл проверку версии: ${temporaryVersion.detail}`);
  }
  const temporaryIntegrity = await checkOmpIntegrity(temporary, expectedSha256);
  if (!temporaryIntegrity.ok) {
    await unlink(temporary).catch(() => undefined);
    throw new Error(`Временный OMP ${temporary} не прошёл SHA-256: ${temporaryIntegrity.detail}`);
  }

  const hadTarget = await isFileLikeEntry(target);
  try {
    if (hadTarget) await rename(target, backup);
    await rename(temporary, target);
    const installedVersion = await checkOmpVersion(target, process.cwd(), version, 5_000, env);
    if (!installedVersion.ok) throw new Error(`Повторная проверка версии установленного OMP ${target} не пройдена: ${installedVersion.detail}`);
    const installedIntegrity = await checkOmpIntegrity(target, expectedSha256);
    if (!installedIntegrity.ok) throw new Error(`Повторная проверка SHA-256 установленного OMP ${target} не пройдена: ${installedIntegrity.detail}`);
    if (hadTarget) await unlink(backup);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    try {
      if (hadTarget && await isFileLikeEntry(backup)) {
        await unlink(target).catch(() => undefined);
        await rename(backup, target);
      } else if (!hadTarget) {
        await unlink(target).catch(() => undefined);
      }
    } catch (rollbackError) {
      throw new Error(`Замена OMP завершилась ошибкой (${messageOf(error)}), и rollback ${backup} -> ${target} не удался: ${messageOf(rollbackError)}`);
    }
    throw error;
  }
}

async function isFileLikeEntry(path: string): Promise<boolean> {
  try {
    const link = await lstat(path);
    return link.isFile() || link.isSymbolicLink();
  } catch {
    return false;
  }
}

function pathsEqual(left: string, right: string | null, platform: NodeJS.Platform): boolean {
  return right !== null && normalized(left, platform) === normalized(right, platform);
}

function pathWithin(root: string, candidate: string, platform: NodeJS.Platform): boolean {
  const pathApi = platform === "win32" ? win32 : posix;
  const segment = pathApi.relative(normalized(root, platform), normalized(candidate, platform));
  return segment === "" || (!segment.startsWith("..") && !pathApi.isAbsolute(segment));
}

function normalized(path: string, platform: NodeJS.Platform): string {
  const value = (platform === "win32" ? win32 : posix).resolve(path);
  return platform === "win32" ? value.toLowerCase() : value;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
