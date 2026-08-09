import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from "electron";
import { spawn } from "node:child_process";
import { join } from "node:path";
import type { AccountPoolConfig, AppSettings, CustomProviderRequest, DiagnosticReport, EmbeddedBrowserBounds, OmpUiResponse, TerminalResult } from "../shared/contracts";
import { safeErrorMessage } from "../shared/redaction";
import { OmpService } from "./omp-service";
import { listProjectFiles, readProjectFile } from "./project-files";
import { SettingsStore } from "./settings-store";
import { browserWindowFor, embeddedBrowserFor } from "./browser-view";
import { inspectOmpInstallation, installBundledOmp } from "./omp-installation";
import { loadOmpLock } from "./omp-runtime";
import { normalizeExternalUrl } from "./external-url";

export function registerIpcHandlers(): void {
  const settings = new SettingsStore(join(app.getPath("userData"), "settings.json"));
  const bundledExecutable = bundledOmpExecutable();
  const service = new OmpService({
    appRoot: app.getAppPath(),
    bundledExecutable,
    getSettings: () => settings.get(),
    accountPoolPath: join(app.getPath("userData"), "omp-account-pool.json"),
    openExternal: async (url) => { await shell.openExternal(normalizeExternalUrl(url)); },
    onUiRequest: (request) => {
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send("omp:ui-request", request);
    },
  });

  app.once("before-quit", () => service.dispose());

  const handle = <TArgs extends unknown[], TResult>(channel: string, operation: (...args: TArgs) => Promise<TResult> | TResult) => {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, async (_event, ...rawArgs: unknown[]) => {
      try {
        return await operation(...(rawArgs as TArgs));
      } catch (error) {
        throw new Error(safeErrorMessage(error));
      }
    });
  };

  const createDiagnostics = async (): Promise<DiagnosticReport> => {
    const current = await settings.get();
    const { recentProjects: _recentProjects, ...safeSettings } = current;
    return {
      generatedAt: new Date().toISOString(),
      app: { name: "mahiko", version: app.getVersion(), platform: process.platform, electron: process.versions.electron ?? "unknown" },
      runtime: await service.runtimeSnapshot(false),
      security: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        recursiveRedaction: true,
      },
      settings: { ...safeSettings, recentProjectCount: current.recentProjects.length },
    };
  };

  handle("runtime:get", async () => service.runtimeSnapshot(false));
  handle("runtime:refresh", async () => { await service.reset(); return service.runtimeSnapshot(false); });
  handle("runtime:installation", async () => inspectOmpInstallation(await installationOptions(bundledExecutable)));
  handle("runtime:install-bundled", async () => {
    const result = await installBundledOmp(await installationOptions(bundledExecutable));
    if (!result.installed) throw new Error("OMP installation did not return an installed executable");
    await settings.update({
      ompExecutableOverride: result.installed.path,
      runtimeSetupComplete: true,
      onboardingComplete: false,
    });
    await service.reset();
    return result;
  });
  handle("application:quit", () => {
    setImmediate(() => app.quit());
  });
  handle("application:open-external", async (url: string) => {
    await shell.openExternal(normalizeExternalUrl(url));
    return { ok: true, message: "Системный браузер открыт" };
  });
  handle("project:choose", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
    const projectPath = result.canceled ? null : result.filePaths[0] ?? null;
    if (!projectPath) return null;
    const current = await settings.get();
    await settings.update({ projectPath, recentProjects: [projectPath, ...current.recentProjects.filter((entry) => entry !== projectPath)] });
    await service.reset();
    return projectPath;
  });
  handle("project:list", async () => listProjectFiles((await settings.get()).projectPath));
  handle("project:read", async (path: string) => readProjectFile((await settings.get()).projectPath, path));
  handle("settings:get", async () => settings.get());
  handle("settings:update", async (patch: Partial<AppSettings>) => {
    const before = await settings.get();
    const next = await settings.update(patch);
    if (before.projectPath !== next.projectPath || before.ompExecutableOverride !== next.ompExecutableOverride) await service.reset();
    return next;
  });

  const browserHandle = <TArgs extends unknown[], TResult>(channel: string, operation: (window: BrowserWindow, ...args: TArgs) => Promise<TResult> | TResult) => {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, async (event, ...rawArgs: unknown[]) => {
      try {
        return await operation(browserWindowFor(event.sender), ...(rawArgs as TArgs));
      } catch (error) {
        throw new Error(safeErrorMessage(error));
      }
    });
  };

  browserHandle("browser:show", async (window, bounds: EmbeddedBrowserBounds, url?: string) => embeddedBrowserFor(window).show(bounds, url));
  browserHandle("browser:hide", (window) => { embeddedBrowserFor(window).hide(); return { ok: true, message: "Браузер скрыт" }; });
  browserHandle("browser:bounds", (window, bounds: EmbeddedBrowserBounds) => { embeddedBrowserFor(window).setBounds(bounds); return { ok: true, message: "Границы браузера обновлены" }; });
  browserHandle("browser:navigate", (window, url: string) => embeddedBrowserFor(window).navigate(url));
  browserHandle("browser:back", (window) => embeddedBrowserFor(window).back());
  browserHandle("browser:forward", (window) => embeddedBrowserFor(window).forward());
  browserHandle("browser:reload", (window) => embeddedBrowserFor(window).reload());
  handle("terminal:run", async (command: string) => runTerminalCommand(command, (await settings.get()).projectPath));
  ipcMain.removeHandler("agent:run");
  ipcMain.handle("agent:run", async (event, prompt: string, runId: string) => {
    try {
      return await service.runAgent(runId, prompt, (streamEvent) => {
        if (!event.sender.isDestroyed()) event.sender.send("agent:event", streamEvent);
      });
    } catch (error) {
      throw new Error(safeErrorMessage(error));
    }
  });
  handle("agent:cancel", (runId: string) => service.cancelAgent(runId));

  handle("omp:state", () => service.getState());
  handle("omp:models", () => service.getModels());
  handle("omp:set-model", (provider: string, modelId: string) => service.setModel(provider, modelId));
  handle("omp:set-thinking", (level: string) => service.setThinkingLevel(level));
  handle("omp:auto-compact", (enabled: boolean) => service.setAutoCompaction(enabled));
  handle("omp:compact", () => service.compact());
  handle("omp:subagents", () => service.getSubagents());
  handle("omp:subagent-settings", () => service.getSubagentSettings());
  handle("omp:set-config", (key: string, value: unknown) => service.setConfig(key, value));
  handle("omp:login-providers", () => service.getLoginProviders());
  handle("omp:login", (providerId: string) => service.login(providerId));
  handle("omp:ui-response", (response: OmpUiResponse) => service.respondUi(response));
  handle("omp:account-pool:get", () => service.getAccountPool());
  handle("omp:account-pool:set", (value: AccountPoolConfig) => service.setAccountPool(value));
  handle("omp:custom-provider", (request: CustomProviderRequest) => service.saveCustomProvider(request));

  handle("diagnostics:get", createDiagnostics);
  handle("diagnostics:copy", async () => {
    clipboard.writeText(JSON.stringify(await createDiagnostics(), null, 2));
    return { ok: true, message: "Очищенная диагностика скопирована" };
  });
}

function bundledOmpExecutable(): string | null {
  const executableName = process.platform === "win32" ? "omp.exe" : "omp";
  if (!(["linux", "win32"] as NodeJS.Platform[]).includes(process.platform) || process.arch !== "x64") return null;
  return app.isPackaged
    ? join(process.resourcesPath, "omp", executableName)
    : join(app.getAppPath(), "vendor", "omp", `${process.platform}-${process.arch}`, executableName);
}

async function installationOptions(bundledPath: string | null) {
  const lock = await loadOmpLock(app.getAppPath());
  const key = `${process.platform}-${process.arch}`;
  const asset = lock.assets[key];
  if (!asset) throw new Error(`Mahiko does not bundle OMP ${lock.version} for ${key}`);
  return { bundledPath, expectedVersion: lock.version, expectedSha256: asset.sha256 };
}


function runTerminalCommand(command: string, projectPath: string): Promise<TerminalResult> {
  const value = command.trim();
  if (!value) throw new Error("Пустая команда");
  if (value.length > 4096) throw new Error("Команда слишком длинная");
  const cwd = projectPath || process.cwd();
  const windows = process.platform === "win32";
  const shellPath = windows ? "powershell.exe" : process.env.SHELL || "/bin/sh";
  const args = windows ? ["-NoProfile", "-NonInteractive", "-Command", value] : ["-lc", value];
  return new Promise((resolve, reject) => {
    const child = spawn(shellPath, args, { cwd, env: { ...process.env, TERM: "xterm-256color" }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    const limit = 1024 * 1024;
    const timeout = setTimeout(() => child.kill("SIGTERM"), 120_000);
    child.stdout.on("data", (chunk: Buffer) => { if (stdout.length < limit) stdout += chunk.toString("utf8").slice(0, limit - stdout.length); });
    child.stderr.on("data", (chunk: Buffer) => { if (stderr.length < limit) stderr += chunk.toString("utf8").slice(0, limit - stderr.length); });
    child.once("error", (error) => { clearTimeout(timeout); reject(error); });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      if (signal) stderr += `\nterminated by ${signal}`;
      resolve({ command: value, cwd, stdout, stderr, exitCode: typeof code === "number" ? code : 1 });
    });
  });
}
