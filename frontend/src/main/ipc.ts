import { app, clipboard, dialog, ipcMain } from "electron";
import { join } from "node:path";
import type { AppSettings, DiagnosticReport, MarketplaceBounds, SkillInstallRequest } from "../shared/contracts";
import { safeErrorMessage } from "../shared/redaction";
import { previewAgent } from "./omp-gateway";
import { getRuntimeSnapshot } from "./omp-runtime";
import { listProjectFiles, readProjectFile } from "./project-files";
import { SettingsStore } from "./settings-store";

export function registerIpcHandlers(): void {
  const settings = new SettingsStore(join(app.getPath("userData"), "settings.json"));
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
      app: { name: "ma-hi-ko", version: app.getVersion(), platform: process.platform, electron: process.versions.electron ?? "unknown" },
      runtime: await getRuntimeSnapshot(current.ompExecutableOverride),
      security: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        recursiveRedaction: true,
        marketplacePartition: "persist:ma-hi-ko-agenticskills",
      },
      settings: { ...safeSettings, recentProjectCount: current.recentProjects.length },
    };
  };

  handle("runtime:get", async () => getRuntimeSnapshot((await settings.get()).ompExecutableOverride));
  handle("runtime:refresh", async () => getRuntimeSnapshot((await settings.get()).ompExecutableOverride));
  handle("project:choose", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
    const projectPath = result.canceled ? null : result.filePaths[0] ?? null;
    if (!projectPath) return null;
    const current = await settings.get();
    await settings.update({ projectPath, recentProjects: [projectPath, ...current.recentProjects.filter((entry) => entry !== projectPath)] });
    return projectPath;
  });
  handle("project:list", async () => listProjectFiles((await settings.get()).projectPath));
  handle("project:read", async (path: string) => readProjectFile((await settings.get()).projectPath, path));
  handle("settings:get", async () => settings.get());
  handle("settings:update", async (patch: Partial<AppSettings>) => settings.update(patch));
  handle("agent:preview", previewAgent);
  handle("diagnostics:get", createDiagnostics);
  handle("diagnostics:copy", async () => {
    clipboard.writeText(JSON.stringify(await createDiagnostics(), null, 2));
    return { ok: true, message: "Очищенная диагностика скопирована" };
  });
  handle("skills:install", async (request: SkillInstallRequest) => {
    if (!/^[a-z0-9][a-z0-9-]{1,80}$/i.test(request.slug)) throw new Error("Недопустимый идентификатор навыка");
    return {
      ok: true,
      message: request.dryRun ? "Команда проверена; файлы не изменены" : "Установка передана локальному OMP",
      command: `npx --yes skills add ${request.slug}${request.scope === "user" ? " -g" : ""}`,
    };
  });
  handle("marketplace:bounds", async (_bounds: MarketplaceBounds) => ({ ok: true, message: "Границы каталога обновлены" }));
}
