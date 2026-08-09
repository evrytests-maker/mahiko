import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { OmpUiRequest, OmpUiResponse, RpcMode } from "../shared/contracts";

interface RpcReadyFrame {
  type: "ready";
  protocolVersion: number;
  supportedProtocolVersions: number[];
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

interface PendingChunks {
  count: number;
  byteLength: number;
  nextIndex: number;
  chunks: Buffer[];
}

export type RpcEvent = Record<string, unknown>;
type EventListener = (frame: RpcEvent) => void;
type UiListener = (request: OmpUiRequest) => void;

export interface PromptOptions {
  signal?: AbortSignal;
  onEvent?: EventListener;
}

export interface PromptResult {
  text: string;
  eventTypes: string[];
  cancelled: boolean;
}

const START_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 30_000;
const TURN_TIMEOUT_MS = 10 * 60_000;
const ABORT_TERMINAL_GRACE_MS = 250;
const MAX_REASSEMBLED_BYTES = 64 * 1024 * 1024;

export class OmpRpcClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private stdoutBuffer = "";
  private readyFrame: RpcReadyFrame | null = null;
  private activeMode: RpcMode | null = null;
  private requestCounter = 0;
  private pending = new Map<string, PendingRequest>();
  private pendingChunks = new Map<string, PendingChunks>();
  private eventListeners = new Set<EventListener>();
  private uiListeners = new Set<UiListener>();
  private stderrTail: string[] = [];
  private startPromise: Promise<void> | null = null;
  private activePrompt = false;

  constructor(
    readonly executable: string,
    readonly cwd: string,
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly modes: readonly RpcMode[] = ["rpc-ui", "rpc"],
  ) {}

  get mode(): RpcMode | null {
    return this.activeMode;
  }

  get protocolVersion(): number | null {
    return this.readyFrame?.protocolVersion ?? null;
  }

  get supportedProtocolVersions(): number[] {
    return this.readyFrame?.supportedProtocolVersions ?? [];
  }

  get connected(): boolean {
    return Boolean(this.child && !this.child.killed && this.readyFrame && this.protocolVersion === 2);
  }

  async start(): Promise<void> {
    if (this.connected) return;
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.startWithFallback().finally(() => { this.startPromise = null; });
    return this.startPromise;
  }

  private async startWithFallback(): Promise<void> {
    let lastError: Error | null = null;
    for (const mode of this.modes) {
      try {
        await this.startMode(mode);
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.resetConnection(lastError);
      }
    }
    throw lastError ?? new Error("OMP RPC mode не настроен");
  }

  private async startMode(mode: RpcMode): Promise<void> {
    this.resetConnection(new Error("OMP RPC connection replaced"));
    this.activeMode = mode;
    const child = spawn(this.executable, [
      "--mode", mode,
      "--cwd", this.cwd,
      "--allow-home",
      "--no-session",
    ], {
      cwd: this.cwd || process.cwd(),
      env: this.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    this.stderrTail = [];
    this.stdoutBuffer = "";

    let readyResolve: (() => void) | null = null;
    let readyReject: ((error: Error) => void) | null = null;
    const ready = new Promise<void>((resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
    });
    const timer = setTimeout(() => readyReject?.(new Error(`OMP ${mode} не прислал ready frame за 10 секунд`)), START_TIMEOUT_MS);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      this.stdoutBuffer += chunk;
      const lines = this.stdoutBuffer.split(/\r?\n/);
      this.stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const frame = this.decodeLine(line);
          if (!frame) continue;
          this.handleFrame(frame);
          if (frame.type === "ready") readyResolve?.();
        } catch (error) {
          readyReject?.(error instanceof Error ? error : new Error(String(error)));
          this.failConnection(error instanceof Error ? error : new Error(String(error)));
        }
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      for (const line of chunk.split(/\r?\n/).filter(Boolean)) {
        this.stderrTail.push(line);
        if (this.stderrTail.length > 12) this.stderrTail.shift();
      }
    });
    child.once("error", (error) => {
      readyReject?.(error);
      this.failConnection(error);
    });
    child.once("exit", (code, signal) => {
      const detail = this.stderrTail.join("\n").trim();
      const error = new Error(`OMP ${mode} завершился (${code ?? signal ?? "unknown"})${detail ? `: ${detail}` : ""}`);
      readyReject?.(error);
      this.failConnection(error, child);
    });

    try {
      await ready;
      if (!this.supportedProtocolVersions.includes(2)) throw new Error(`OMP ${mode} не поддерживает protocol v2`);
      const negotiated = await this.requestStarted<{ protocolVersion?: number }>({ type: "negotiate_protocol", protocolVersion: 2 });
      if (negotiated?.protocolVersion !== 2 || !this.readyFrame) throw new Error("OMP RPC protocol v2 negotiation failed");
      this.readyFrame.protocolVersion = 2;
    } finally {
      clearTimeout(timer);
      readyResolve = null;
      readyReject = null;
    }
  }

  async request<T = unknown>(command: RpcEvent, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
    await this.start();
    return this.requestStarted<T>(command, timeoutMs);
  }

  private requestStarted<T = unknown>(command: RpcEvent, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
    const child = this.child;
    if (!child || !this.readyFrame) return Promise.reject(new Error("OMP RPC недоступен"));
    const id = `mahiko_${++this.requestCounter}`;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`OMP RPC timeout: ${String(command.type ?? "request")}`));
      }, timeoutMs);
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
      child.stdin.write(`${JSON.stringify({ ...command, id })}\n`, "utf8", (error) => {
        if (!error) return;
        const pending = this.pending.get(id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(id);
        pending.reject(error);
      });
    });
  }

  async prompt(message: string, options: PromptOptions = {}): Promise<PromptResult> {
    if (this.activePrompt) throw new Error("OMP уже выполняет запрос");
    if (options.signal?.aborted) return { text: "", eventTypes: [], cancelled: true };
    await this.start();
    this.activePrompt = true;

    const eventTypes: string[] = [];
    const text: string[] = [];
    const commandOutput: string[] = [];
    let cancelled = false;
    let terminal = false;
    let localOnly = false;
    let abortGraceTimer: NodeJS.Timeout | null = null;
    let settle: (() => void) | null = null;
    const settled = new Promise<void>((resolve) => { settle = resolve; });
    const listener: EventListener = (frame) => {
      const type = typeof frame.type === "string" ? frame.type : "";
      if (type && type !== "response") eventTypes.push(type);
      if (type === "message_update") {
        const event = isRecord(frame.assistantMessageEvent) ? frame.assistantMessageEvent : null;
        if (event?.type === "text_delta" && typeof event.delta === "string") text.push(event.delta);
        if (event?.type === "error" && event.reason === "aborted") cancelled = true;
      }
      if (type === "command_output" && typeof frame.text === "string") commandOutput.push(frame.text);
      if (type === "prompt_result" && frame.agentInvoked === false) {
        localOnly = true;
        settle?.();
      }
      if (type === "agent_end" && frame.isTerminal !== false) {
        terminal = true;
        if (abortGraceTimer) {
          clearTimeout(abortGraceTimer);
          abortGraceTimer = null;
        }
        settle?.();
      }
      options.onEvent?.(frame);
    };
    this.eventListeners.add(listener);

    const abort = () => {
      cancelled = true;
      void this.requestStarted({ type: "abort" }, 15_000)
        .then(() => {
          if (terminal) { settle?.(); return; }
          abortGraceTimer = setTimeout(() => {
            abortGraceTimer = null;
            if (!terminal) this.resetConnection(new Error("OMP abort confirmed without terminal agent_end"));
            settle?.();
          }, ABORT_TERMINAL_GRACE_MS);
        })
        .catch((error) => {
          this.resetConnection(error instanceof Error ? error : new Error("OMP abort failed"));
          settle?.();
        });
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    try {
      const response = await this.requestStarted<{ agentInvoked?: boolean }>({ type: "prompt", message }, 45_000);
      if (response?.agentInvoked === false) localOnly = true;
      if (!localOnly && !terminal) await withTimeout(settled, TURN_TIMEOUT_MS, "OMP turn не завершился terminal agent_end");
      if (cancelled) return { text: text.join(""), eventTypes, cancelled: true };
      if (localOnly) {
        const localText = commandOutput.join("\n").trim();
        if (!localText) throw new Error("OMP prompt завершился локально без command_output");
        return { text: localText, eventTypes, cancelled: false };
      }
      const last = await this.requestStarted<{ text?: string | null }>({ type: "get_last_assistant_text" });
      const finalText = typeof last?.text === "string" ? last.text.trim() : text.join("").trim();
      if (!finalText) throw new Error("OMP завершил запрос без текста ассистента");
      return { text: finalText, eventTypes, cancelled: false };
    } finally {
      if (abortGraceTimer) clearTimeout(abortGraceTimer);
      options.signal?.removeEventListener("abort", abort);
      this.eventListeners.delete(listener);
      this.activePrompt = false;
    }
  }

  onEvent(listener: EventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onUiRequest(listener: UiListener): () => void {
    this.uiListeners.add(listener);
    return () => this.uiListeners.delete(listener);
  }

  respondUi(response: OmpUiResponse): Promise<void> {
    const child = this.child;
    if (!child || !this.connected) throw new Error("OMP RPC недоступен");
    if (typeof response.id !== "string" || response.id.length < 1 || response.id.length > 256) throw new Error("Недопустимый OMP UI request id");
    if ("value" in response && (typeof response.value !== "string" || response.value.length > 1024 * 1024)) throw new Error("Недопустимый OMP UI value");
    if ("confirmed" in response && typeof response.confirmed !== "boolean") throw new Error("Недопустимый OMP UI confirmation");
    if ("cancelled" in response && response.cancelled !== true) throw new Error("Недопустимый OMP UI cancellation");
    const payload = "value" in response
      ? { type: "extension_ui_response", id: response.id, value: response.value }
      : "confirmed" in response
        ? { type: "extension_ui_response", id: response.id, confirmed: response.confirmed }
        : { type: "extension_ui_response", id: response.id, cancelled: true };
    return new Promise((resolve, reject) => {
      child.stdin.write(`${JSON.stringify(payload)}\n`, "utf8", (error) => error ? reject(error) : resolve());
    });
  }

  dispose(): void {
    this.resetConnection(new Error("OMP RPC connection reset"));
  }

  private decodeLine(line: string): RpcEvent | null {
    const parsed: unknown = JSON.parse(line);
    if (!isRecord(parsed)) throw new Error("OMP emitted a malformed RPC frame");
    if (parsed.type !== "rpc_chunk") return parsed;
    const chunkId = typeof parsed.chunkId === "string" ? parsed.chunkId : "";
    const index = typeof parsed.index === "number" ? parsed.index : -1;
    const count = typeof parsed.count === "number" ? parsed.count : -1;
    const byteLength = typeof parsed.byteLength === "number" ? parsed.byteLength : -1;
    const data = typeof parsed.data === "string" ? parsed.data : "";
    if (!chunkId || index < 0 || count < 1 || count > 512 || byteLength < 0 || byteLength > MAX_REASSEMBLED_BYTES) {
      throw new Error("OMP emitted invalid protocol v2 chunk metadata");
    }
    let pending = this.pendingChunks.get(chunkId);
    if (!pending) {
      if (index !== 0) throw new Error("OMP protocol v2 chunk sequence started out of order");
      pending = { count, byteLength, nextIndex: 0, chunks: [] };
      this.pendingChunks.set(chunkId, pending);
    }
    if (pending.count !== count || pending.byteLength !== byteLength || pending.nextIndex !== index) {
      throw new Error("OMP protocol v2 chunk sequence is inconsistent");
    }
    pending.chunks.push(Buffer.from(data, "base64"));
    pending.nextIndex += 1;
    if (pending.nextIndex < pending.count) return null;
    this.pendingChunks.delete(chunkId);
    const payload = Buffer.concat(pending.chunks);
    if (payload.byteLength !== pending.byteLength) throw new Error("OMP protocol v2 frame length mismatch");
    const logical: unknown = JSON.parse(payload.toString("utf8"));
    if (!isRecord(logical)) throw new Error("OMP protocol v2 frame is not an object");
    return logical;
  }

  private handleFrame(frame: RpcEvent): void {
    if (frame.type === "ready") {
      this.readyFrame = {
        type: "ready",
        protocolVersion: typeof frame.protocolVersion === "number" ? frame.protocolVersion : 1,
        supportedProtocolVersions: Array.isArray(frame.supportedProtocolVersions)
          ? frame.supportedProtocolVersions.filter((value): value is number => Number.isSafeInteger(value))
          : [1],
      };
    }
    if (frame.type === "response" && typeof frame.id === "string") {
      const pending = this.pending.get(frame.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(frame.id);
        if (frame.success === false) pending.reject(new Error(typeof frame.error === "string" ? frame.error : "OMP RPC request failed"));
        else pending.resolve(frame.data);
      }
    }
    if (frame.type === "extension_ui_request" && typeof frame.id === "string" && typeof frame.method === "string") {
      const request = normalizeUiRequest(frame);
      if (request) for (const listener of this.uiListeners) listener(request);
    }
    for (const listener of this.eventListeners) listener(frame);
  }

  private failConnection(error: Error, source = this.child): void {
    if (source && this.child !== source) return;
    this.stdoutBuffer = "";
    this.readyFrame = null;
    this.activeMode = null;
    this.pendingChunks.clear();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    if (source && this.child === source) this.child = null;
  }

  private resetConnection(error: Error): void {
    const child = this.child;
    this.child = null;
    if (child && !child.killed) child.kill("SIGTERM");
    this.failConnection(error, null);
  }
}

function normalizeUiRequest(frame: RpcEvent): OmpUiRequest | null {
  const id = String(frame.id);
  switch (frame.method) {
    case "open_url":
      return {
        type: "open_url", id, url: String(frame.url ?? ""),
        launchUrl: typeof frame.launchUrl === "string" ? frame.launchUrl : undefined,
        instructions: typeof frame.instructions === "string" ? frame.instructions : undefined,
      };
    case "select":
      return { type: "select", id, title: String(frame.title ?? "Выберите значение"), options: Array.isArray(frame.options) ? frame.options.map(String) : [] };
    case "input":
      return { type: "input", id, title: typeof frame.title === "string" ? frame.title : undefined, message: String(frame.title ?? "Введите значение"), placeholder: typeof frame.placeholder === "string" ? frame.placeholder : undefined };
    case "editor":
      return { type: "editor", id, title: String(frame.title ?? "Редактор"), prefill: typeof frame.prefill === "string" ? frame.prefill : "" };
    case "confirm":
      return { type: "confirm", id, title: typeof frame.title === "string" ? frame.title : undefined, message: String(frame.message ?? "Подтвердить действие?") };
    case "cancel":
      return { type: "cancel", id, targetId: String(frame.targetId ?? "") };
    case "notify":
      return { type: "notify", id, message: String(frame.message ?? ""), level: typeof frame.notifyType === "string" ? frame.notifyType : undefined };
    case "setStatus":
      return { type: "status", id, key: String(frame.statusKey ?? ""), text: typeof frame.statusText === "string" ? frame.statusText : null };
    case "setWidget":
      return { type: "widget", id, key: String(frame.widgetKey ?? ""), lines: Array.isArray(frame.widgetLines) ? frame.widgetLines.map(String) : null };
    case "setTitle":
      return { type: "title", id, title: String(frame.title ?? "") };
    case "set_editor_text":
      return { type: "editor_text", id, text: String(frame.text ?? "") };
    default:
      return null;
  }
}

function isRecord(value: unknown): value is RpcEvent {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function withTimeout(promise: Promise<void>, timeoutMs: number, message: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    void promise.then(() => { clearTimeout(timer); resolve(); }, (error) => { clearTimeout(timer); reject(error); });
  });
}
