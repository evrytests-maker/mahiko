import { execFile } from "node:child_process";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type {
  AccountPoolConfig,
  AccountPoolSnapshot,
  AgentRunResult,
  AgentStreamEvent,
  AppSettings,
  CustomProviderRequest,
  CustomProviderResult,
  OmpConfigEntry,
  OmpLoginProvider,
  OmpModel,
  OmpSessionState,
  OmpSubagent,
  OmpThinkingLevel,
  OmpUiRequest,
  OmpUiResponse,
  OperationResult,
  RuntimeSnapshot,
} from "../shared/contracts";
import { safeErrorMessage } from "../shared/redaction";
import { discoverRuntime, loadOmpLock, type OmpLock } from "./omp-runtime";
import { OmpRpcClient, type RpcEvent } from "./omp-rpc-client";

const execFileAsync = promisify(execFile);
const SUBAGENT_KEYS = new Set([
  "task.batch",
  "task.enableEffort",
  "task.maxConcurrency",
  "task.maxRecursionDepth",
  "task.maxRuntimeMs",
]);
const OMP_THINKING_LEVELS = new Set<OmpThinkingLevel>(["minimal", "low", "medium", "high", "xhigh", "max"]);

interface OmpServiceOptions {
  appRoot: string;
  bundledExecutable?: string | null;
  getSettings(): Promise<AppSettings>;
  accountPoolPath: string;
  onUiRequest(request: OmpUiRequest): void;
  openExternal(url: string): Promise<void>;
}

export class OmpService {
  private client: OmpRpcClient | null = null;
  private clientKey = "";
  private clientStart: { key: string; client: OmpRpcClient; promise: Promise<OmpRpcClient> } | null = null;
  private removeUiListener: (() => void) | null = null;
  private lockPromise: Promise<OmpLock> | null = null;
  private activeRun: { id: string; controller: AbortController } | null = null;

  constructor(private readonly options: OmpServiceOptions) {}

  dispose(): void {
    this.activeRun?.controller.abort();
    this.activeRun = null;
    this.removeUiListener?.();
    this.removeUiListener = null;
    this.client?.dispose();
    this.client = null;
    this.clientKey = "";
    this.clientStart = null;
  }

  async reset(): Promise<void> {
    this.dispose();
  }

  async runtimeSnapshot(connectRpc = false): Promise<RuntimeSnapshot> {
    const settings = await this.options.getSettings();
    const snapshot = await discoverRuntime(settings.projectPath || process.cwd(), await this.lock(), settings.ompExecutableOverride, { bundledExecutable: this.options.bundledExecutable });
    if (!connectRpc || !snapshot.compatible || !snapshot.rpc.ready) return snapshot;
    try {
      const client = await this.ensureClient();
      return {
        ...snapshot,
        rpc: { ready: true, protocolVersion: client.protocolVersion, supportedProtocolVersions: client.supportedProtocolVersions, mode: client.mode, detail: `OMP RPC подключён (${settings.projectPath || process.cwd()})` },
      };
    } catch (error) {
      return {
        ...snapshot,
        rpc: { ready: false, protocolVersion: null, supportedProtocolVersions: snapshot.rpc.supportedProtocolVersions, mode: null, detail: safeErrorMessage(error) },
      };
    }
  }

  async getState(): Promise<OmpSessionState | null> {
    const data = await (await this.ensureClient()).request<unknown>({ type: "get_state" });
    return normalizeSessionState(data);
  }

  async getModels(): Promise<OmpModel[]> {
    const data = await (await this.ensureClient()).request<unknown>({ type: "get_available_models" });
    const models = isRecord(data) && Array.isArray(data.models) ? data.models : [];
    return models.map(normalizeModel).filter((model): model is OmpModel => Boolean(model));
  }

  async setModel(provider: string, modelId: string): Promise<OmpModel> {
    const client = await this.ensureClient();
    await client.request({ type: "set_model", provider, modelId });
    for (let attempt = 0; attempt < 21; attempt += 1) {
      const state = normalizeSessionState(await client.request<unknown>({ type: "get_state" }));
      if (state?.model?.provider === provider && state.model.id === modelId) return state.model;
      if (attempt < 20) await delay(100);
    }
    throw new Error("OMP не подтвердил выбранную модель в get_state");
  }

  async setThinkingLevel(level: string): Promise<OperationResult> {
    if (!/^(off|minimal|low|medium|high|xhigh|max|auto)$/.test(level)) throw new Error("Неподдерживаемый thinking level");
    await (await this.ensureClient()).request({ type: "set_thinking_level", level });
    const state = await this.getState();
    // OMP keeps `auto` as the configured selector but exposes the concrete
    // provisional effort in get_state (for example `high`). The successful RPC
    // receipt plus a valid state is therefore the observable confirmation.
    if (level === "auto" && state) return { ok: true, message: `Thinking level: ${level}` };
    if (state?.thinkingLevel !== level) throw new Error("OMP не подтвердил thinking level в get_state");
    return { ok: true, message: `Thinking level: ${level}` };
  }

  async setAutoCompaction(enabled: boolean): Promise<OperationResult> {
    await (await this.ensureClient()).request({ type: "set_auto_compaction", enabled });
    const state = await this.getState();
    if (!state || state.autoCompactionEnabled !== enabled) throw new Error("OMP не подтвердил изменение auto-compaction");
    return { ok: true, message: enabled ? "Автосжатие включено в OMP" : "Автосжатие выключено в OMP" };
  }

  async compact(): Promise<OperationResult> {
    await (await this.ensureClient()).request({ type: "compact" }, 3 * 60_000);
    return { ok: true, message: "Команда compact принята OMP" };
  }

  async getSubagents(): Promise<OmpSubagent[]> {
    const data = await (await this.ensureClient()).request<unknown>({ type: "get_subagents" });
    const list = isRecord(data) && Array.isArray(data.subagents)
      ? data.subagents
      : isRecord(data) && Array.isArray(data.agents)
        ? data.agents
        : Array.isArray(data) ? data : [];
    return list.filter(isRecord).map((entry, index) => ({
      id: String(entry.id ?? `agent-${index + 1}`),
      index: typeof entry.index === "number" ? entry.index : index,
      agent: String(entry.agent ?? entry.type ?? "task"),
      description: typeof entry.description === "string" ? entry.description : undefined,
      status: String(entry.status ?? "unknown"),
      task: typeof entry.task === "string" ? entry.task : undefined,
      assignment: typeof entry.assignment === "string" ? entry.assignment : undefined,
      sessionFile: typeof entry.sessionFile === "string" ? entry.sessionFile : undefined,
      lastUpdate: typeof entry.lastUpdate === "number" ? entry.lastUpdate : Date.now(),
    }));
  }

  async getSubagentSettings(): Promise<OmpConfigEntry[]> {
    const all = await this.listConfig();
    return all.filter((entry) => SUBAGENT_KEYS.has(entry.key));
  }

  async setConfig(key: string, value: unknown): Promise<OmpConfigEntry> {
    if (!SUBAGENT_KEYS.has(key)) throw new Error(`GUI не изменяет неподтверждённый OMP key: ${key}`);
    const settings = await this.options.getSettings();
    const executable = await this.requireExecutable(settings);
    const rawValue = typeof value === "string" ? value : typeof value === "object" ? JSON.stringify(value) : String(value);
    await this.run(executable, ["config", "set", key, rawValue, "--json"], settings.projectPath);
    const updated = (await this.listConfig()).find((entry) => entry.key === key);
    if (!updated) throw new Error(`OMP config list не вернул ${key} после записи`);
    this.dispose();
    return updated;
  }

  async getLoginProviders(): Promise<OmpLoginProvider[]> {
    const data = await (await this.ensureClient()).request<unknown>({ type: "get_login_providers" });
    const list = isRecord(data) && Array.isArray(data.providers) ? data.providers : [];
    return list.filter(isRecord).map((provider) => ({
      id: String(provider.id ?? ""),
      name: String(provider.name ?? provider.id ?? ""),
      available: provider.available === true,
      authenticated: provider.authenticated === true,
    })).filter((provider) => provider.id.length > 0);
  }

  async login(providerId: string): Promise<OperationResult> {
    if (!providerId.trim()) throw new Error("providerId обязателен");
    await (await this.ensureClient()).request({ type: "login", providerId }, 10 * 60_000);
    const providers = await this.getLoginProviders();
    const provider = providers.find((entry) => entry.id === providerId);
    if (!provider?.authenticated) throw new Error(`OMP завершил login, но ${providerId} не помечен authenticated`);
    return { ok: true, message: `OMP подтвердил вход: ${provider?.name ?? providerId}` };
  }

  async respondUi(response: OmpUiResponse): Promise<OperationResult> {
    (await this.ensureClient()).respondUi(response);
    return { ok: true, message: "Ответ отправлен в OMP RPC" };
  }

  async getAccountPool(): Promise<AccountPoolSnapshot> {
    const value = await readAccountPool(this.options.accountPoolPath);
    return { configured: Object.keys(value).length > 0, filePath: this.options.accountPoolPath, value, requiresRestart: this.client !== null };
  }

  async setAccountPool(value: AccountPoolConfig): Promise<AccountPoolSnapshot> {
    const normalized = normalizeAccountPool(value);
    await mkdir(dirname(this.options.accountPoolPath), { recursive: true });
    const temporary = `${this.options.accountPoolPath}.tmp`;
    await writeFile(temporary, `${JSON.stringify(normalized, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, this.options.accountPoolPath);
    const hadClient = this.client !== null;
    this.dispose();
    return { configured: Object.keys(normalized).length > 0, filePath: this.options.accountPoolPath, value: normalized, requiresRestart: hadClient };
  }

  async saveCustomProvider(request: CustomProviderRequest): Promise<CustomProviderResult> {
    validateCustomProvider(request);
    const settings = await this.options.getSettings();
    const executable = await this.requireExecutable(settings);
    const configPathOutput = await this.run(executable, ["config", "path"], settings.projectPath);
    const agentDir = configPathOutput.stdout.trim();
    if (!agentDir) throw new Error("omp config path вернул пустой путь");

    const yamlPath = join(agentDir, "models.yml");
    const yamlAltPath = join(agentDir, "models.yaml");
    const legacyJsonPath = join(agentDir, "models.json");
    const hasYml = await exists(yamlPath);
    const hasYaml = await exists(yamlAltPath);
    if (hasYml && hasYaml) {
      throw new Error("Найдены одновременно models.yml и models.yaml. GUI не выбирает между двумя OMP config-файлами автоматически.");
    }
    const targetPath = hasYaml ? yamlAltPath : yamlPath;
    let root: Record<string, unknown> = {};
    let previousTarget: string | null = null;
    if (hasYml || hasYaml) {
      previousTarget = await readFile(targetPath, "utf8");
      let parsed: unknown;
      try {
        // JSON is valid YAML. We only mutate an existing YAML file when its
        // exact contents are JSON-compatible, which lets us preserve/merge it
        // without pretending to own YAML comments, anchors or formatting.
        parsed = JSON.parse(previousTarget) as unknown;
      } catch {
        throw new Error("Существующий OMP models.yml/models.yaml использует YAML-синтаксис. GUI не перезаписывает его без безопасного YAML AST; custom provider нужно добавить в OMP config вручную.");
      }
      if (!isRecord(parsed)) throw new Error("OMP models config должен содержать объект");
      root = parsed;
    } else if (await exists(legacyJsonPath)) {
      const legacy = await readFile(legacyJsonPath, "utf8");
      const parsed = JSON.parse(legacy) as unknown;
      if (!isRecord(parsed)) throw new Error("legacy models.json должен содержать объект");
      root = parsed;
    }
    const providers = isRecord(root.providers) ? { ...root.providers } : {};
    const provider: Record<string, unknown> = {
      baseUrl: request.baseUrl.trim(),
      api: request.api.trim(),
      models: [{ id: request.modelId.trim(), name: request.modelName?.trim() || request.modelId.trim() }],
    };
    if (request.auth === "none") {
      provider.auth = "none";
    } else {
      if (!request.apiKey?.trim()) throw new Error("API key обязателен для auth=api-key");
      provider.apiKey = request.apiKey.trim();
    }
    providers[request.providerId.trim()] = provider;
    root.providers = providers;
    await mkdir(agentDir, { recursive: true });
    const nextContent = `${JSON.stringify(root, null, 2)}\n`;
    const temporary = `${targetPath}.tmp`;
    await writeFile(temporary, nextContent, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, targetPath);

    const selector = `${request.providerId.trim()}/${request.modelId.trim()}`;
    try {
      const result = await this.run(executable, ["models", request.providerId.trim(), "--json"], settings.projectPath, 45_000);
      const parsed = JSON.parse(result.stdout) as unknown;
      const models = isRecord(parsed) && Array.isArray(parsed.models) ? parsed.models : [];
      const observed = models.some((entry) => isRecord(entry) && entry.selector === selector);
      if (!observed) throw new Error(`OMP models не вернул ${selector}; конфигурация откатана`);
    } catch (error) {
      if (previousTarget === null) {
        await unlink(targetPath).catch(() => undefined);
      } else {
        await writeFile(targetPath, previousTarget, { encoding: "utf8", mode: 0o600 });
      }
      throw error;
    }
    this.dispose();
    return { ok: true, message: `OMP подтвердил custom provider ${selector}`, selector, configPath: targetPath };
  }

  async runAgent(runId: string, prompt: string, onEvent: (event: AgentStreamEvent) => void): Promise<AgentRunResult> {
    if (!/^[a-zA-Z0-9:_-]{1,120}$/.test(runId)) throw new Error("Недопустимый runId");
    const normalized = prompt.trim();
    if (!normalized) throw new Error("Пустой запрос не может быть выполнен");
    if (normalized.length > 8_000) throw new Error("Запрос превышает лимит 8000 символов");
    if (this.activeRun) throw new Error("OMP уже выполняет другой запрос");
    const client = await this.ensureClient();
    const controller = new AbortController();
    this.activeRun = { id: runId, controller };
    onEvent({ runId, type: "started" });
    try {
      const result = await client.prompt(normalized, {
        signal: controller.signal,
        onEvent: (frame) => {
          const event = normalizeAgentEvent(runId, frame);
          if (event) onEvent(event);
        },
      });
      const observedEventTypes = [...new Set(result.eventTypes)].filter(Boolean);
      if (result.cancelled || controller.signal.aborted) {
        onEvent({ runId, type: "cancelled" });
        return { runId, text: result.text, cancelled: true, observedEventTypes };
      }
      onEvent({ runId, type: "completed", text: result.text, observedEventTypes });
      return { runId, text: result.text, cancelled: false, observedEventTypes };
    } catch (error) {
      if (controller.signal.aborted) {
        onEvent({ runId, type: "cancelled" });
        return { runId, text: "", cancelled: true, observedEventTypes: [] };
      }
      const message = safeErrorMessage(error);
      onEvent({ runId, type: "error", message });
      throw error;
    } finally {
      if (this.activeRun?.controller === controller) this.activeRun = null;
    }
  }

  cancelAgent(runId: string): OperationResult {
    if (!this.activeRun || this.activeRun.id !== runId) return { ok: false, message: "Активный OMP-запрос не найден" };
    this.activeRun.controller.abort();
    return { ok: true, message: "Отмена отправлена в OMP" };
  }

  private async listConfig(): Promise<OmpConfigEntry[]> {
    const settings = await this.options.getSettings();
    const executable = await this.requireExecutable(settings);
    const { stdout } = await this.run(executable, ["config", "list", "--json"], settings.projectPath);
    const parsed = JSON.parse(stdout) as unknown;
    if (!isRecord(parsed)) throw new Error("omp config list --json вернул неожиданный формат");
    return Object.entries(parsed).filter(([, value]) => isRecord(value)).map(([key, raw]) => {
      const value = raw as Record<string, unknown>;
      return {
        key,
        value: value.value,
        redacted: value.redacted === true,
        type: typeof value.type === "string" ? value.type : "string",
        description: typeof value.description === "string" ? value.description : "",
      };
    });
  }

  private async ensureClient(): Promise<OmpRpcClient> {
    const active = this.activeClient();
    if (active) return active;
    const settings = await this.options.getSettings();
    const runtime = await this.verifiedRuntime(settings);
    const executable = runtime.executable;
    if (!executable || !runtime.rpc.mode) throw new Error(runtime.rpc.detail);
    const cwd = settings.projectPath || process.cwd();
    const accountPool = await readAccountPool(this.options.accountPoolPath);
    const poolStamp = Object.keys(accountPool).length > 0 ? (await safeMtime(this.options.accountPoolPath)).toString() : "none";
    const key = `${executable}\0${cwd}\0${poolStamp}\0${runtime.rpc.mode}`;
    const concurrent = this.activeClient(key);
    if (concurrent) return concurrent;
    this.dispose();
    const env = { ...process.env };
    if (Object.keys(accountPool).length > 0) env.OMP_AUTH_BROKER_ACCOUNT_POOL_FILE = this.options.accountPoolPath;
    const client = new OmpRpcClient(executable, cwd, env, [runtime.rpc.mode]);
    this.client = client;
    this.clientKey = key;
    this.removeUiListener = client.onUiRequest((request) => {
      if (request.type === "open_url" && request.url.startsWith("https://")) void this.options.openExternal(request.url);
      this.options.onUiRequest(request);
    });
    const promise = (async () => {
      try {
        await client.start();
        return client;
      } catch (error) {
        if (this.client === client) this.dispose();
        throw error;
      } finally {
        if (this.clientStart?.client === client) this.clientStart = null;
      }
    })();
    this.clientStart = { key, client, promise };
    return promise;
  }

  private activeClient(expectedKey?: string): Promise<OmpRpcClient> | null {
    if (expectedKey && this.clientKey !== expectedKey) return null;
    if (this.client?.connected) return Promise.resolve(this.client);
    return this.clientStart?.promise ?? null;
  }

  private async requireExecutable(settings: AppSettings): Promise<string> {
    const runtime = await discoverRuntime(settings.projectPath || process.cwd(), await this.lock(), settings.ompExecutableOverride, {
      bundledExecutable: this.options.bundledExecutable,
      probeRpc: false,
    });
    if (!runtime.compatible || !runtime.executable) {
      const detail = !runtime.versionCheck.ok
        ? runtime.versionCheck.detail
        : runtime.integrity.ok === false
          ? runtime.integrity.detail
          : runtime.rpc.detail;
      throw new Error(detail);
    }
    return runtime.executable;
  }

  private async verifiedRuntime(settings: AppSettings): Promise<RuntimeSnapshot> {
    const runtime = await discoverRuntime(settings.projectPath || process.cwd(), await this.lock(), settings.ompExecutableOverride, { bundledExecutable: this.options.bundledExecutable });
    if (!runtime.compatible || !runtime.rpc.ready || runtime.rpc.protocolVersion !== 2) throw new Error(runtime.rpc.detail);
    return runtime;
  }

  private lock(): Promise<OmpLock> {
    this.lockPromise ??= loadOmpLock(this.options.appRoot);
    return this.lockPromise;
  }

  private async run(executable: string, args: string[], cwd: string, timeout = 30_000): Promise<{ stdout: string; stderr: string }> {
    const result = await execFileAsync(executable, args, { cwd: cwd || process.cwd(), timeout, maxBuffer: 2 * 1024 * 1024, env: process.env });
    return { stdout: result.stdout, stderr: result.stderr };
  }
}

function normalizeAgentEvent(runId: string, frame: RpcEvent): AgentStreamEvent | null {
  if (frame.type === "message_update" && isRecord(frame.assistantMessageEvent)) {
    const event = frame.assistantMessageEvent;
    if (event.type === "text_delta" && typeof event.delta === "string") return { runId, type: "text_delta", delta: event.delta };
    if (event.type === "thinking_start" && typeof event.contentIndex === "number") {
      return { runId, type: "thinking_start", contentIndex: event.contentIndex };
    }
    if (event.type === "thinking_delta" && typeof event.contentIndex === "number" && typeof event.delta === "string") {
      return { runId, type: "thinking_delta", contentIndex: event.contentIndex, delta: event.delta };
    }
    if (event.type === "thinking_end" && typeof event.contentIndex === "number" && typeof event.content === "string") {
      return { runId, type: "thinking_end", contentIndex: event.contentIndex, content: event.content };
    }
    return null;
  }
  if (frame.type === "tool_execution_start" && typeof frame.toolCallId === "string" && typeof frame.toolName === "string") {
    return { runId, type: "tool_start", toolCallId: frame.toolCallId, toolName: frame.toolName };
  }
  if (frame.type === "tool_execution_update" && typeof frame.toolCallId === "string" && typeof frame.toolName === "string") {
    return { runId, type: "tool_update", toolCallId: frame.toolCallId, toolName: frame.toolName, summary: "Инструмент выполняется" };
  }
  if (frame.type === "tool_execution_end" && typeof frame.toolCallId === "string" && typeof frame.toolName === "string") {
    const isError = frame.isError === true;
    return { runId, type: "tool_end", toolCallId: frame.toolCallId, toolName: frame.toolName, isError, summary: isError ? "Инструмент завершился с ошибкой" : "Инструмент завершён" };
  }
  if (frame.type === "notice" && typeof frame.message === "string") {
    const level = frame.level === "warning" || frame.level === "error" ? frame.level : "info";
    return { runId, type: "notice", level, message: safeErrorMessage(frame.message) };
  }
  return null;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function normalizeModel(raw: unknown): OmpModel | null {
  if (!isRecord(raw) || typeof raw.provider !== "string" || typeof raw.id !== "string") return null;
  const thinking = isRecord(raw.thinking) ? raw.thinking : null;
  const thinkingLevels = thinking && Array.isArray(thinking.efforts)
    ? thinking.efforts.filter((level): level is OmpThinkingLevel => typeof level === "string" && OMP_THINKING_LEVELS.has(level as OmpThinkingLevel))
    : [];
  return {
    provider: raw.provider,
    id: raw.id,
    name: typeof raw.name === "string" ? raw.name : raw.id,
    contextWindow: typeof raw.contextWindow === "number" ? raw.contextWindow : null,
    maxTokens: typeof raw.maxTokens === "number" ? raw.maxTokens : null,
    reasoning: raw.reasoning === true,
    thinkingLevels,
    supportsThinkingOff: raw.reasoning === true && thinking?.requiresEffort !== true,
  };
}

function normalizeSessionState(raw: unknown): OmpSessionState | null {
  if (!isRecord(raw)) return null;
  // The GUI is a client of OMP, not an owner of OMP defaults. Treat an
  // incomplete state frame as unavailable instead of manufacturing values
  // such as "auto-compaction = true" or zero message counts in the frontend.
  if (
    typeof raw.isStreaming !== "boolean" ||
    typeof raw.isCompacting !== "boolean" ||
    typeof raw.sessionId !== "string" ||
    typeof raw.autoCompactionEnabled !== "boolean" ||
    (raw.tokensPerSecond !== null && typeof raw.tokensPerSecond !== "number") ||
    typeof raw.messageCount !== "number" ||
    typeof raw.queuedMessageCount !== "number"
  ) return null;
  const model = normalizeModel(raw.model);
  const contextUsage = isRecord(raw.contextUsage) ? { ...raw.contextUsage } : undefined;
  return {
    model: model ?? undefined,
    thinkingLevel: typeof raw.thinkingLevel === "string" ? raw.thinkingLevel : undefined,
    isStreaming: raw.isStreaming,
    isCompacting: raw.isCompacting,
    sessionFile: typeof raw.sessionFile === "string" ? raw.sessionFile : undefined,
    sessionId: raw.sessionId,
    sessionName: typeof raw.sessionName === "string" ? raw.sessionName : undefined,
    autoCompactionEnabled: raw.autoCompactionEnabled,
    fastModeEnabled: typeof raw.fastModeEnabled === "boolean" ? raw.fastModeEnabled : undefined,
    fastModeActive: typeof raw.fastModeActive === "boolean" ? raw.fastModeActive : undefined,
    tokensPerSecond: raw.tokensPerSecond,
    messageCount: raw.messageCount,
    queuedMessageCount: raw.queuedMessageCount,
    contextUsage,
  };
}

function normalizeAccountPool(value: AccountPoolConfig): AccountPoolConfig {
  if (!isRecord(value)) throw new Error("Account pool должен быть объектом provider -> identityKey[]");
  const normalized: AccountPoolConfig = {};
  for (const [provider, identities] of Object.entries(value)) {
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(provider)) throw new Error(`Недопустимый provider id в account pool: ${provider}`);
    if (!Array.isArray(identities)) throw new Error(`Account pool ${provider} должен быть массивом identityKey`);
    const unique = new Set<string>();
    for (const identity of identities) {
      if (typeof identity !== "string" || !identity || identity.trim() !== identity) throw new Error(`identityKey для ${provider} должен быть непустой строкой без внешних пробелов`);
      unique.add(identity);
    }
    normalized[provider] = [...unique];
  }
  return normalized;
}

async function readAccountPool(path: string): Promise<AccountPoolConfig> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    return normalizeAccountPool(parsed as AccountPoolConfig);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return {};
    throw error;
  }
}

function validateCustomProvider(request: CustomProviderRequest): void {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(request.providerId.trim())) throw new Error("Provider id должен состоять из букв, цифр, точки, _ или -");
  const url = new URL(request.baseUrl);
  if (!/^https?:$/.test(url.protocol)) throw new Error("Custom API base URL должен использовать http/https");
  if (!request.api.trim()) throw new Error("OMP API id обязателен");
  if (!request.modelId.trim()) throw new Error("Model id обязателен");
}

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; } catch { return false; }
}
async function safeMtime(path: string): Promise<number> {
  try { return (await stat(path)).mtimeMs; } catch { return 0; }
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
