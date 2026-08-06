export type GatewayMode = "mock" | "rpc-ui" | "rpc" | "offline";

export interface RpcStatus {
  ready: boolean;
  protocolVersion: number | null;
  supportedProtocolVersions: number[];
  mode: "rpc-ui" | "rpc" | null;
  detail: string;
}

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface ThinkingOption {
  id: ThinkingLevel;
  label: string;
  description: string;
}

export interface OmpThinkingConfig {
  source: "omp-runtime" | "fallback";
  detail: string;
  defaultLevel: ThinkingLevel;
  levels: ThinkingOption[];
}

export const ompThinkingOptions: ThinkingOption[] = [
  { id: "off", label: "Без рассуждения", description: "Ответ без дополнительного reasoning-бюджета" },
  { id: "minimal", label: "Минимально", description: "Короткая проверка перед ответом" },
  { id: "low", label: "Низко", description: "Быстрое решение простых задач" },
  { id: "medium", label: "Средне", description: "Сбалансированная глубина по умолчанию" },
  { id: "high", label: "Высоко", description: "Больше времени на сложные изменения" },
  { id: "xhigh", label: "Максимально", description: "Максимальный уровень, поддерживаемый OMP" },
];

export interface RuntimeSnapshot {
  checkedAt: string;
  executable: string | null;
  version: string | null;
  available: boolean;
  rpc: RpcStatus;
  gatewayMode: GatewayMode;
  thinking: OmpThinkingConfig;
}

export type ThemeName = "dark" | "light" | "contrast";

export interface AppSettings {
  theme: ThemeName;
  navWidth: number;
  inspectorWidth: number;
  navVisible: boolean;
  inspectorVisible: boolean;
  recentProjects: string[];
  projectPath: string;
  ompExecutableOverride: string | null;
  marketplaceVisible: boolean;
  autoCompact: boolean;
  compactionThreshold: number;
  compactionStrategy: "balanced" | "conservative" | "aggressive";
}

export interface DiagnosticReport {
  generatedAt: string;
  app: {
    name: "ma-hi-ko";
    version: string;
    platform: string;
    electron: string;
  };
  runtime: RuntimeSnapshot;
  security: {
    contextIsolation: true;
    sandbox: true;
    nodeIntegration: false;
    recursiveRedaction: true;
    marketplacePartition: string;
  };
  settings: Omit<AppSettings, "recentProjects"> & { recentProjectCount: number };
}

export type ActivityKind =
  | "explore"
  | "read"
  | "plan"
  | "edit"
  | "command"
  | "verify"
  | "complete"
  | "error"
  | "cancelled";

export type ActivityStatus = "pending" | "running" | "success" | "error" | "cancelled";

export interface ActivityStepTemplate {
  id: string;
  kind: ActivityKind;
  summary: string;
  detail?: string;
  durationMs: number;
  command?: string;
  output?: string[];
  exitCode?: number;
  outcome?: "success" | "error";
  errorMessage?: string;
  recoveryHint?: string;
}

export interface ActivityEvent extends ActivityStepTemplate {
  status: ActivityStatus;
  startedAt?: number;
  endedAt?: number;
}

export interface ActivityRun {
  id: string;
  prompt: string;
  attempt: number;
  status: ActivityStatus;
  safeSummary: string;
  events: ActivityEvent[];
  startedAt: number;
  endedAt?: number;
}

export interface PreviewOptions {
  attempt?: number;
  runId?: string;
}

export interface PreviewReply {
  id: string;
  summary: string;
  chunks: string[];
  activity: ActivityStepTemplate[];
}

export interface MarketplaceBounds {
  visible: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SkillInstallRequest {
  slug: string;
  scope: "user" | "project";
  projectPath?: string;
  dryRun: boolean;
}

export interface OperationResult {
  ok: boolean;
  message: string;
  command?: string;
}

export interface ProjectFileEntry {
  path: string;
  name: string;
  kind: "file" | "directory";
  depth: number;
}

export interface ProjectFilePreview {
  path: string;
  content: string;
  truncated: boolean;
}

export interface MaHiKoApi {
  runtime: {
    getSnapshot(): Promise<RuntimeSnapshot>;
    refresh(): Promise<RuntimeSnapshot>;
  };
  project: {
    choose(): Promise<string | null>;
    listFiles(): Promise<ProjectFileEntry[]>;
    readFile(path: string): Promise<ProjectFilePreview>;
  };
  settings: {
    get(): Promise<AppSettings>;
    update(patch: Partial<AppSettings>): Promise<AppSettings>;
  };
  diagnostics: {
    get(): Promise<DiagnosticReport>;
    copy(): Promise<OperationResult>;
  };
  agent: {
    preview(prompt: string, options?: PreviewOptions): Promise<PreviewReply>;
  };
  skills: {
    install(request: SkillInstallRequest): Promise<OperationResult>;
  };
  marketplace: {
    setBounds(bounds: MarketplaceBounds): Promise<OperationResult>;
  };
}

export const defaultSettings: AppSettings = {
  theme: "dark",
  navWidth: 312,
  inspectorWidth: 356,
  navVisible: true,
  inspectorVisible: true,
  recentProjects: [],
  projectPath: "",
  ompExecutableOverride: null,
  marketplaceVisible: false,
  autoCompact: true,
  compactionThreshold: 82,
  compactionStrategy: "balanced",
};
