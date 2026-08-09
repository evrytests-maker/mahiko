import { randomUUID, createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { chmod, lstat, mkdir, mkdtemp, rename, rm, unlink } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, posix, win32 } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { OmpInstallation, OmpInstallationSnapshot } from "../shared/contracts";
import { checkOmpIntegrity, checkOmpVersion, type OmpLock } from "./omp-runtime";

export const OMP_INSTALL_TIMEOUT_MS = 900_000;

export interface InstallerRunContext {
  platform: NodeJS.Platform;
  installerPath: string;
  targetPath: string;
  versionRef: string;
  timeoutMs: number;
  env: NodeJS.ProcessEnv;
  cwd: string;
  isolatedUserProfile: string;
}

export type OmpInstallerRunner = (context: InstallerRunContext) => Promise<void>;

export interface InstallerInvocation {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

export interface OfficialOmpInstallerOptions {
  assetUrl: string;
  installerUrl: string;
  targetPath: string;
  expectedVersion: string;
  expectedCliVersion: string;
  expectedSha256: string;
  expectedInstallerSha256: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  installerRunner?: OmpInstallerRunner;
}

export interface InstallationOptions extends OfficialOmpInstallerOptions {
  home?: string;
}

export interface InstalledOmp {
  path: string;
  versionCheck: Awaited<ReturnType<typeof checkOmpVersion>>;
  integrity: Awaited<ReturnType<typeof checkOmpIntegrity>>;
}

interface Candidate {
  path: string;
  source: OmpInstallation["source"];
}

export function officialOmpAsset(lock: OmpLock, platform: NodeJS.Platform, arch: string) {
  const asset = lock.assets[`${platform}-${arch}`];
  if (!asset) throw new Error(`OMP ${lock.version} не опубликован для ${platform}-${arch}`);
  return { ...asset, executableName: platform === "win32" ? "omp.exe" : "omp" };
}

export function officialOmpInstaller(lock: OmpLock, platform: NodeJS.Platform) {
  const installer = lock.installers[platform];
  if (!installer) throw new Error(`Официальный installer OMP ${lock.version} не опубликован для ${platform}`);
  return installer;
}

export function officialOmpCliPath(platform: NodeJS.Platform, home = homedir(), env: NodeJS.ProcessEnv = process.env): string {
  if (platform === "win32") {
    return win32.join(env.LOCALAPPDATA || win32.join(home, "AppData", "Local"), "omp", "omp.exe");
  }
  return posix.join(home, ".local", "bin", "omp");
}

export function officialOmpInstallerCommand(context: InstallerRunContext): InstallerInvocation {
  const installDirectory = dirnameFor(context.platform, context.targetPath);
  const windows = context.platform === "win32";
  return {
    command: windows ? "powershell.exe" : "sh",
    args: windows
      ? ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", context.installerPath, "-Binary", "-Ref", context.versionRef]
      : [context.installerPath, "--binary", "--ref", context.versionRef],
    env: {
      ...context.env,
      PI_INSTALL_DIR: installDirectory,
      ...(windows ? { USERPROFILE: context.isolatedUserProfile } : {}),
    },
  };
}

export async function inspectOmpInstallation(options: InstallationOptions): Promise<OmpInstallationSnapshot> {
  const env = options.env ?? process.env;
  const home = options.home ?? homedir();
  const platform = options.platform ?? process.platform;
  const managedVersionCheck = await checkOmpVersion(options.targetPath, process.cwd(), options.expectedVersion, 5_000, env, options.expectedCliVersion);
  const managedIntegrity = await checkOmpIntegrity(options.targetPath, options.expectedSha256);
  const managedReady = managedVersionCheck.ok && managedIntegrity.ok === true;
  let external: OmpInstallation | null = null;
  for (const candidate of externalCandidates(env, home, platform)) {
    if (pathsEqual(candidate.path, options.targetPath, platform) || !await isFileLikeEntry(candidate.path)) continue;
    const versionCheck = await checkOmpVersion(candidate.path, process.cwd(), options.expectedVersion, 5_000, env);
    external = { path: candidate.path, version: versionCheck.foundVersion, versionCheck, source: candidate.source };
    break;
  }
  const selectedPath = managedReady ? options.targetPath : external?.versionCheck.ok ? external.path : null;
  return {
    checkedAt: new Date().toISOString(),
    expectedVersion: options.expectedVersion,
    assetUrl: options.assetUrl,
    expectedSha256: options.expectedSha256,
    managedPath: options.targetPath,
    managedVersion: managedVersionCheck.foundVersion,
    managedSha256: managedIntegrity.actualSha256,
    managedVersionCheck,
    managedIntegrity,
    managedReady,
    external,
    selectedPath,
    dataLocations: ompDataLocations(env, home, platform),
    detail: installationDetail(options, managedReady, external),
  };
}

export async function installOfficialOmp(options: InstallationOptions): Promise<OmpInstallationSnapshot> {
  const before = await inspectOmpInstallation(options);
  if (before.selectedPath) return before;
  await runOfficialOmpInstaller(options);
  const after = await inspectOmpInstallation(options);
  if (!after.managedReady || after.selectedPath !== options.targetPath) {
    throw new Error(`OMP установлен в ${options.targetPath}, но повторная проверка не подтвердила ${options.expectedCliVersion}: ${after.detail}`);
  }
  return after;
}

export async function runOfficialOmpInstaller(options: OfficialOmpInstallerOptions): Promise<InstalledOmp> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const timeoutMs = options.timeoutMs ?? OMP_INSTALL_TIMEOUT_MS;
  const temporaryRoot = await mkdtemp(join(tmpdir(), "mahiko-omp-installer-"));
  const installerPath = join(temporaryRoot, platform === "win32" ? "install.ps1" : "install.sh");
  const isolatedUserProfile = join(temporaryRoot, "profile");
  const backup = `${options.targetPath}.mahiko-backup-${randomUUID()}`;
  let backupCreated = false;
  let installerStarted = false;

  try {
    await downloadVerifiedInstaller(options, installerPath, timeoutMs);
    if (platform !== "win32") await chmod(installerPath, 0o700);
    await mkdir(dirnameFor(platform, options.targetPath), { recursive: true });
    await mkdir(isolatedUserProfile, { recursive: true });
    if (await isFileLikeEntry(options.targetPath)) {
      await rename(options.targetPath, backup);
      backupCreated = true;
    }
    installerStarted = true;
    await (options.installerRunner ?? executeOfficialInstaller)({
      platform,
      installerPath,
      targetPath: options.targetPath,
      versionRef: `v${options.expectedVersion}`,
      timeoutMs,
      env,
      cwd: temporaryRoot,
      isolatedUserProfile,
    });
    if (platform !== "win32") await chmod(options.targetPath, 0o755);
    const versionCheck = await checkOmpVersion(options.targetPath, process.cwd(), options.expectedVersion, 5_000, env, options.expectedCliVersion);
    if (!versionCheck.ok) throw new Error(`Установленный OMP не прошёл проверку версии: ${versionCheck.detail}`);
    const integrity = await checkOmpIntegrity(options.targetPath, options.expectedSha256);
    if (!integrity.ok) throw new Error(`SHA-256 установленного OMP не совпадает: ${integrity.detail}`);
    if (backupCreated) await unlink(backup);
    backupCreated = false;
    return { path: options.targetPath, versionCheck, integrity };
  } catch (error) {
    if (installerStarted) {
      try {
        await unlink(options.targetPath).catch(() => undefined);
        if (backupCreated) {
          await rename(backup, options.targetPath);
          backupCreated = false;
        }
      } catch (rollbackError) {
        throw new Error(`Официальный installer завершился ошибкой (${messageOf(error)}), и rollback ${backup} -> ${options.targetPath} не удался: ${messageOf(rollbackError)}`);
      }
    }
    throw new Error(`Не удалось установить OMP официальным installer ${options.installerUrl}: ${messageOf(error)}`);
  } finally {
    if (backupCreated) await rename(backup, options.targetPath).catch(() => undefined);
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function downloadVerifiedInstaller(options: OfficialOmpInstallerOptions, installerPath: string, timeoutMs: number): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref();
  try {
    const response = await (options.fetchImpl ?? fetch)(options.installerUrl, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": "mahiko" },
    });
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
    const hash = createHash("sha256");
    const hasher = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    await pipeline(
      Readable.from(response.body as unknown as AsyncIterable<Uint8Array>),
      hasher,
      createWriteStream(installerPath, { flags: "wx", mode: 0o600 }),
      { signal: controller.signal },
    );
    const actualSha256 = hash.digest("hex");
    if (actualSha256 !== options.expectedInstallerSha256) {
      throw new Error(`SHA-256 official installer не совпадает: найден ${actualSha256}, ожидается ${options.expectedInstallerSha256}`);
    }
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`Загрузка official installer ${options.installerUrl} превысила timeout ${timeoutMs} мс`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function executeOfficialInstaller(context: InstallerRunContext): Promise<void> {
  const invocation = officialOmpInstallerCommand(context);

  await new Promise<void>((resolve, reject) => {
    execFile(invocation.command, invocation.args, {
      cwd: context.cwd,
      env: invocation.env,
      timeout: context.timeoutMs,
      maxBuffer: 128 * 1024,
      windowsHide: true,
      encoding: "utf8",
    }, (error, stdout, stderr) => {
      if (!error) {
        resolve();
        return;
      }
      const detail = String(stderr || stdout || error.message).trim();
      const timedOut = "killed" in error && error.killed;
      reject(new Error(timedOut
        ? `Официальный installer превысил timeout ${context.timeoutMs} мс${detail ? `: ${detail}` : ""}`
        : `Официальный installer завершился с ошибкой: ${detail || error.message}`));
    });
  });
}

function installationDetail(options: InstallationOptions, managedReady: boolean, external: OmpInstallation | null): string {
  if (managedReady) return `Официальный CLI OMP ${options.expectedVersion} проверен по пути ${options.targetPath}; Mahiko и терминал используют общие профили и сессии`;
  if (external?.versionCheck.ok) return `Совместимый внешний CLI OMP ${external.version} найден по пути ${external.path}; файл не изменяется`;
  if (external) return `Найден несовместимый внешний OMP ${external.version ?? "unknown"} по пути ${external.path}; файл не изменяется. Официальный installer установит OMP ${options.expectedVersion} в ${options.targetPath}`;
  return `Совместимый OMP не найден. После согласия будет запущен официальный installer ${options.expectedVersion}; CLI установится в ${options.targetPath}`;
}

function externalCandidates(env: NodeJS.ProcessEnv, home: string, platform: NodeJS.Platform): Candidate[] {
  const pathApi = platform === "win32" ? win32 : posix;
  const executableName = platform === "win32" ? "omp.exe" : "omp";
  const candidates: Candidate[] = platform === "win32"
    ? [
        { path: pathApi.join(env.LOCALAPPDATA || pathApi.join(home, "AppData", "Local"), "omp", executableName), source: "official" },
        ...(env.PATH ?? "").split(";").filter(Boolean).map((directory): Candidate => ({ path: pathApi.join(directory, executableName), source: "path" })),
      ]
    : [
        { path: pathApi.join(home, ".local", "bin", executableName), source: "official" },
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

async function isFileLikeEntry(path: string): Promise<boolean> {
  try {
    const link = await lstat(path);
    return link.isFile() || link.isSymbolicLink();
  } catch {
    return false;
  }
}

function pathsEqual(left: string, right: string, platform: NodeJS.Platform): boolean {
  return normalized(left, platform) === normalized(right, platform);
}

function normalized(path: string, platform: NodeJS.Platform): string {
  const value = (platform === "win32" ? win32 : posix).resolve(path);
  return platform === "win32" ? value.toLowerCase() : value;
}

function dirnameFor(platform: NodeJS.Platform, path: string): string {
  return (platform === "win32" ? win32 : posix).dirname(path);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
