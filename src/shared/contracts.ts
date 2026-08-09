export type RpcMode = "rpc-ui" | "rpc";

export interface RpcStatus {
  ready: boolean;
  protocolVersion: number | null;
  supportedProtocolVersions: number[];
  mode: RpcMode | null;
  detail: string;
  attemptedMode?: RpcMode;
  failureStage?: "discovery" | "version" | "integrity" | "readiness" | "protocol" | "runtime";
  errorCode?: string;
}

export type OmpVersionCheckCode = "ok" | "ENOENT" | "EACCES" | "timeout" | "unknown-format" | "nonzero-exit" | "version-mismatch" | "spawn-error";

export interface OmpVersionCheck {
  ok: boolean;
  code: OmpVersionCheckCode;
  path: string;
  expectedVersion: string;
  foundVersion: string | null;
  exitCode: number | null;
  detail: string;
}

export interface OmpIntegrityCheck {
  checked: boolean;
  ok: boolean | null;
  path: string | null;
  expectedSha256: string | null;
  actualSha256: string | null;
  detail: string;
}

export interface RuntimeSnapshot {
  checkedAt: string;
  executable: string | null;
  expectedVersion: string;
  version: string | null;
  available: boolean;
  compatible: boolean;
  versionCheck: OmpVersionCheck;
  integrity: OmpIntegrityCheck;
  rpc: RpcStatus;
}

export interface OmpInstallation {
  path: string;
  version: string | null;
  source: "path" | "official" | "bun";
  versionCheck: OmpVersionCheck;
}

export interface OmpInstallationSnapshot {
  checkedAt: string;
  expectedVersion: string;
  assetUrl: string;
  expectedSha256: string;
  managedPath: string;
  managedVersion: string | null;
  managedSha256: string | null;
  managedVersionCheck: OmpVersionCheck;
  managedIntegrity: OmpIntegrityCheck;
  managedReady: boolean;
  external: OmpInstallation | null;
  selectedPath: string | null;
  dataLocations: string[];
  detail: string;
}

export type ThemeName = "omp" | "claude" | "codex";

export interface AppSettings {
  theme: ThemeName;
  navWidth: number;
  inspectorWidth: number;
  navVisible: boolean;
  inspectorVisible: boolean;
  recentProjects: string[];
  projectPath: string;
  ompExecutableOverride: string | null;
  runtimeSetupComplete: boolean;
  onboardingComplete: boolean;
}

export interface DiagnosticReport {
  generatedAt: string;
  app: {
    name: "mahiko";
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

export interface ObservedThinkingBlock {
  contentIndex: number;
  text: string;
  status: "running" | "complete";
}

export interface ActivityRun {
  id: string;
  prompt: string;
  attempt: number;
  status: ActivityStatus;
  safeSummary: string;
  events: ActivityEvent[];
  thinkingBlocks: ObservedThinkingBlock[];
  startedAt: number;
  endedAt?: number;
}

export type AgentStreamEvent =
  | { runId: string; type: "started" }
  | { runId: string; type: "text_delta"; delta: string }
  | { runId: string; type: "thinking_start"; contentIndex: number }
  | { runId: string; type: "thinking_delta"; contentIndex: number; delta: string }
  | { runId: string; type: "thinking_end"; contentIndex: number; content: string }
  | { runId: string; type: "tool_start"; toolCallId: string; toolName: string }
  | { runId: string; type: "tool_update"; toolCallId: string; toolName: string; summary: string }
  | { runId: string; type: "tool_end"; toolCallId: string; toolName: string; isError: boolean; summary: string }
  | { runId: string; type: "notice"; level: "info" | "warning" | "error"; message: string }
  | { runId: string; type: "completed"; text: string; observedEventTypes: string[] }
  | { runId: string; type: "cancelled" }
  | { runId: string; type: "error"; message: string };

export interface AgentRunResult {
  runId: string;
  text: string;
  cancelled: boolean;
  observedEventTypes: string[];
}

export type OmpThinkingLevel = "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface OmpModel {
  provider: string;
  id: string;
  name: string;
  contextWindow: number | null;
  maxTokens: number | null;
  reasoning: boolean;
  thinkingLevels: OmpThinkingLevel[];
  supportsThinkingOff: boolean;
}

export interface OmpContextUsage {
  tokens?: number;
  contextWindow?: number;
  percent?: number;
  [key: string]: unknown;
}

export interface OmpSessionState {
  model?: OmpModel;
  thinkingLevel?: string;
  isStreaming: boolean;
  isCompacting: boolean;
  sessionFile?: string;
  sessionId: string;
  sessionName?: string;
  autoCompactionEnabled: boolean;
  fastModeEnabled?: boolean;
  fastModeActive?: boolean;
  tokensPerSecond: number | null;
  messageCount: number;
  queuedMessageCount: number;
  contextUsage?: OmpContextUsage;
}

export interface OmpSubagent {
  id: string;
  index: number;
  agent: string;
  description?: string;
  status: string;
  task?: string;
  assignment?: string;
  sessionFile?: string;
  lastUpdate: number;
}

export interface OmpLoginProvider {
  id: string;
  name: string;
  available: boolean;
  authenticated: boolean;
}

export interface OmpConfigEntry {
  key: string;
  value?: unknown;
  redacted?: boolean;
  type: "boolean" | "number" | "string" | "enum" | "array" | "record" | string;
  description: string;
}

export type AccountPoolConfig = Record<string, string[]>;

export interface AccountPoolSnapshot {
  configured: boolean;
  filePath: string;
  value: AccountPoolConfig;
  requiresRestart: boolean;
}

export interface CustomProviderRequest {
  providerId: string;
  baseUrl: string;
  /**
   * Passed through to OMP's models config and validated by OMP itself.
   * Keep this open-ended: the GUI must not become a second source of truth
   * for the current OMP API-id schema.
   */
  api: string;
  apiKey?: string;
  auth: "api-key" | "none";
  modelId: string;
  modelName?: string;
}

export interface CustomProviderResult extends OperationResult {
  selector?: string;
  configPath?: string;
}

export type OmpUiRequest =
  | { type: "open_url"; id: string; url: string; launchUrl?: string; instructions?: string }
  | { type: "select"; id: string; title: string; options: string[] }
  | { type: "input"; id: string; title?: string; message: string; placeholder?: string }
  | { type: "editor"; id: string; title: string; prefill: string }
  | { type: "confirm"; id: string; title?: string; message: string }
  | { type: "cancel"; id: string; targetId: string }
  | { type: "notify"; id: string; message: string; level?: string }
  | { type: "status"; id: string; key: string; text: string | null }
  | { type: "widget"; id: string; key: string; lines: string[] | null }
  | { type: "title"; id: string; title: string }
  | { type: "editor_text"; id: string; text: string };

export type OmpUiResponse =
  | { id: string; value: string }
  | { id: string; confirmed: boolean }
  | { id: string; cancelled: true };

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

export interface EmbeddedBrowserBounds {
  visible: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EmbeddedBrowserState {
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  error: string | null;
}

export interface TerminalResult {
  command: string;
  cwd: string;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface MahikoApi {
  runtime: {
    getSnapshot(): Promise<RuntimeSnapshot>;
    refresh(): Promise<RuntimeSnapshot>;
    getInstallation(): Promise<OmpInstallationSnapshot>;
    installOfficial(): Promise<OmpInstallationSnapshot>;
  };
  application: {
    openExternal(url: string): Promise<OperationResult>;
    quit(): Promise<void>;
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
  browser: {
    show(bounds: EmbeddedBrowserBounds, url?: string): Promise<EmbeddedBrowserState>;
    hide(): Promise<OperationResult>;
    setBounds(bounds: EmbeddedBrowserBounds): Promise<OperationResult>;
    navigate(url: string): Promise<EmbeddedBrowserState>;
    back(): Promise<EmbeddedBrowserState>;
    forward(): Promise<EmbeddedBrowserState>;
    reload(): Promise<EmbeddedBrowserState>;
    onState(listener: (state: EmbeddedBrowserState) => void): () => void;
  };
  terminal: {
    run(command: string): Promise<TerminalResult>;
  };
  diagnostics: {
    get(): Promise<DiagnosticReport>;
    copy(): Promise<OperationResult>;
  };
  agent: {
    run(prompt: string, runId: string): Promise<AgentRunResult>;
    cancel(runId: string): Promise<OperationResult>;
    onEvent(listener: (event: AgentStreamEvent) => void): () => void;
  };
  omp: {
    getState(): Promise<OmpSessionState | null>;
    getModels(): Promise<OmpModel[]>;
    setModel(provider: string, modelId: string): Promise<OmpModel>;
    setThinkingLevel(level: string): Promise<OperationResult>;
    setAutoCompaction(enabled: boolean): Promise<OperationResult>;
    compact(): Promise<OperationResult>;
    getSubagents(): Promise<OmpSubagent[]>;
    getSubagentSettings(): Promise<OmpConfigEntry[]>;
    setConfig(key: string, value: unknown): Promise<OmpConfigEntry>;
    getLoginProviders(): Promise<OmpLoginProvider[]>;
    login(providerId: string): Promise<OperationResult>;
    onUiRequest(listener: (request: OmpUiRequest) => void): () => void;
    respondUi(request: OmpUiResponse): Promise<OperationResult>;
    getAccountPool(): Promise<AccountPoolSnapshot>;
    setAccountPool(value: AccountPoolConfig): Promise<AccountPoolSnapshot>;
    saveCustomProvider(request: CustomProviderRequest): Promise<CustomProviderResult>;
  };
}

export const defaultSettings: AppSettings = {
  theme: "omp",
  navWidth: 196,
  inspectorWidth: 600,
  navVisible: false,
  inspectorVisible: false,
  recentProjects: [],
  projectPath: "",
  ompExecutableOverride: null,
  runtimeSetupComplete: false,
  onboardingComplete: false,
};
