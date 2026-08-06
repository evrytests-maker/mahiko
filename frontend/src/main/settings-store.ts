import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AppSettings, ThemeName } from "../shared/contracts";
import { defaultSettings } from "../shared/contracts";

const themes = new Set<ThemeName>(["dark", "light", "contrast"]);
const compactionStrategies = new Set<AppSettings["compactionStrategy"]>(["balanced", "conservative", "aggressive"]);

export function normalizeSettings(value: unknown): AppSettings {
  const input = isRecord(value) ? value : {};
  const recentProjects = Array.isArray(input.recentProjects)
    ? [...new Set(input.recentProjects.filter((entry): entry is string => typeof entry === "string" && entry.length > 0))].slice(0, 12)
    : defaultSettings.recentProjects;

  return {
    theme: typeof input.theme === "string" && themes.has(input.theme as ThemeName) ? input.theme as ThemeName : defaultSettings.theme,
    navWidth: clampNumber(input.navWidth, 280, 380, defaultSettings.navWidth),
    inspectorWidth: clampNumber(input.inspectorWidth, 320, 460, defaultSettings.inspectorWidth),
    navVisible: typeof input.navVisible === "boolean" ? input.navVisible : defaultSettings.navVisible,
    inspectorVisible: typeof input.inspectorVisible === "boolean" ? input.inspectorVisible : defaultSettings.inspectorVisible,
    recentProjects,
    projectPath: typeof input.projectPath === "string" ? input.projectPath : defaultSettings.projectPath,
    ompExecutableOverride: typeof input.ompExecutableOverride === "string" ? input.ompExecutableOverride : null,
    marketplaceVisible: typeof input.marketplaceVisible === "boolean" ? input.marketplaceVisible : defaultSettings.marketplaceVisible,
    autoCompact: typeof input.autoCompact === "boolean" ? input.autoCompact : defaultSettings.autoCompact,
    compactionThreshold: clampNumber(input.compactionThreshold, 60, 95, defaultSettings.compactionThreshold),
    compactionStrategy: typeof input.compactionStrategy === "string" && compactionStrategies.has(input.compactionStrategy as AppSettings["compactionStrategy"])
      ? input.compactionStrategy as AppSettings["compactionStrategy"]
      : defaultSettings.compactionStrategy,
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

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
