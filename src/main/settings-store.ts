import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AppSettings, ThemeName } from "../shared/contracts";
import { defaultSettings } from "../shared/contracts";

const themes = new Set<ThemeName>(["omp", "claude", "codex"]);

export function normalizeSettings(value: unknown): AppSettings {
  const input = isRecord(value) ? value : {};
  const recentProjects = Array.isArray(input.recentProjects)
    ? [...new Set(input.recentProjects.filter((entry): entry is string => typeof entry === "string" && entry.length > 0))].slice(0, 12)
    : defaultSettings.recentProjects;

  return {
    theme: normalizeTheme(input.theme),
    navWidth: clampNumber(input.navWidth, 168, 360, defaultSettings.navWidth),
    inspectorWidth: clampNumber(input.inspectorWidth, 360, 720, defaultSettings.inspectorWidth),
    navVisible: typeof input.navVisible === "boolean" ? input.navVisible : defaultSettings.navVisible,
    inspectorVisible: typeof input.inspectorVisible === "boolean" ? input.inspectorVisible : defaultSettings.inspectorVisible,
    recentProjects,
    projectPath: typeof input.projectPath === "string" ? input.projectPath : defaultSettings.projectPath,
    ompExecutableOverride: typeof input.ompExecutableOverride === "string" ? input.ompExecutableOverride : null,
    runtimeSetupComplete: typeof input.runtimeSetupComplete === "boolean" ? input.runtimeSetupComplete : defaultSettings.runtimeSetupComplete,
    onboardingComplete: typeof input.onboardingComplete === "boolean" ? input.onboardingComplete : defaultSettings.onboardingComplete,
  };
}

export class SettingsStore {
  constructor(private readonly filePath: string) {}

  async get(): Promise<AppSettings> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return normalizeSettings(JSON.parse(raw));
    } catch {
      return { ...defaultSettings };
    }
  }

  async update(patch: Partial<AppSettings>): Promise<AppSettings> {
    const current = await this.get();
    const next = normalizeSettings({ ...current, ...patch });
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, this.filePath);
    return next;
  }
}

function normalizeTheme(value: unknown): ThemeName {
  if (typeof value !== "string") return defaultSettings.theme;
  if (themes.has(value as ThemeName)) return value as ThemeName;
  // Migrate settings written by older builds without keeping obsolete themes in the UI.
  if (["dark", "light", "contrast"].includes(value)) return "omp";
  return defaultSettings.theme;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
