import type {
  AppSettings,
  DiagnosticReport,
  MaHiKoApi,
  ProjectFileEntry,
  RuntimeSnapshot,
} from "../shared/contracts";
import { defaultSettings, ompThinkingOptions } from "../shared/contracts";
import { createPreviewReply } from "../shared/preview-fixture";

const runtimeFixture: RuntimeSnapshot = {
  checkedAt: new Date().toISOString(),
  executable: "/home/pupsik/.bun/bin/omp",
  version: "17.2.9",
  available: true,
  rpc: {
    ready: true,
    protocolVersion: 2,
    supportedProtocolVersions: [1, 2],
    mode: "rpc-ui",
    detail: "Данные браузерного предпросмотра",
  },
  gatewayMode: "mock",
  thinking: {
    source: "omp-runtime",
    detail: "Данные browser preview поступают через runtime-контракт OMP",
    defaultLevel: "xhigh",
    levels: ompThinkingOptions,
  },
};

let browserSettings: AppSettings = {
  ...defaultSettings,
  projectPath: "/home/pupsik/Документы/Codex/2026-08-05/codex-1-codex-hooks-skills-python",
};

const browserFiles: ProjectFileEntry[] = [
  { path: "skills", name: "skills", kind: "directory", depth: 0 },
  { path: "skills/ponytail", name: "ponytail", kind: "directory", depth: 1 },
  { path: "skills/ponytail/SKILL.md", name: "SKILL.md", kind: "file", depth: 2 },
  { path: "src", name: "src", kind: "directory", depth: 0 },
  { path: "src/renderer", name: "renderer", kind: "directory", depth: 1 },
  { path: "src/renderer/App.tsx", name: "App.tsx", kind: "file", depth: 2 },
  { path: "src/renderer/styles.css", name: "styles.css", kind: "file", depth: 2 },
  { path: "work", name: "work", kind: "directory", depth: 0 },
  { path: "info.md", name: "info.md", kind: "file", depth: 0 },
  { path: "package.json", name: "package.json", kind: "file", depth: 0 },
];

const browserApi: MaHiKoApi = {
  runtime: {
    getSnapshot: async () => runtimeFixture,
    refresh: async () => ({ ...runtimeFixture, checkedAt: new Date().toISOString() }),
  },
  project: {
    choose: async () => null,
    listFiles: async () => structuredClone(browserFiles),
    readFile: async (path) => ({
      path,
      content: path.endsWith("App.tsx")
        ? "import { useState } from \"react\";\n\nexport function App() {\n  return <main>ma-hi-ko</main>;\n}\n"
        : `# ${path}\n\nФайл проекта открыт в безопасном браузерном предпросмотре.`,
      truncated: false,
    }),
  },
  settings: {
    get: async () => structuredClone(browserSettings),
    update: async (patch) => {
      browserSettings = { ...browserSettings, ...patch };
      return structuredClone(browserSettings);
    },
  },
  diagnostics: {
    get: async (): Promise<DiagnosticReport> => ({
      generatedAt: new Date().toISOString(),
      app: { name: "ma-hi-ko", version: "0.1.0", platform: "linux", electron: "browser-preview" },
      runtime: runtimeFixture,
      security: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        recursiveRedaction: true,
        marketplacePartition: "persist:ma-hi-ko-agenticskills",
      },
      settings: { ...browserSettings, recentProjectCount: browserSettings.recentProjects.length } as DiagnosticReport["settings"],
    }),
    copy: async () => ({ ok: true, message: "Очищенная диагностика скопирована" }),
  },
  agent: { preview: async (prompt, options) => createPreviewReply(prompt, options) },
  skills: {
    install: async (request) => ({
      ok: true,
      message: request.dryRun ? "Команда проверена; файлы не изменены" : "Навык установлен",
      command: `npx --yes skills add ${request.slug}${request.scope === "user" ? " -g" : ""}`,
    }),
  },
  marketplace: { setBounds: async () => ({ ok: true, message: "В браузерном предпросмотре используется встроенный каталог" }) },
};

export const api = window.maHiKo ?? browserApi;
export const isElectron = Boolean(window.maHiKo);
