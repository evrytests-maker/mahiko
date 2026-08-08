import { beforeEach, describe, expect, it, vi } from "vitest";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const fakes = vi.hoisted(() => ({
  start: vi.fn<() => Promise<void>>(),
  dispose: vi.fn(),
  request: vi.fn<(frame: Record<string, unknown>) => Promise<unknown>>(),
  prompt: vi.fn<(message: string, options: { onEvent?(frame: Record<string, unknown>): void }) => Promise<{ text: string; eventTypes: string[]; cancelled: boolean }>>(),
}));

vi.mock("./omp-runtime", () => ({
  loadOmpLock: vi.fn(async () => ({ version: "17.2.9" })),
  discoverRuntime: vi.fn(async () => ({
    executable: "/tmp/omp",
    installedVersion: "17.2.9",
    requiredVersion: "17.2.9",
    compatible: true,
    rpc: {
      ready: true,
      protocolVersion: 2,
      supportedProtocolVersions: [2],
      mode: "rpc-ui",
      detail: "ready",
    },
  })),
}));

vi.mock("./omp-rpc-client", () => ({
  OmpRpcClient: class {
    connected = false;
    readonly protocolVersion = 2;
    readonly supportedProtocolVersions = [2];
    readonly mode = "rpc-ui";

    async start(): Promise<void> {
      await fakes.start();
      this.connected = true;
    }

    request(frame: Record<string, unknown>): Promise<unknown> {
      return fakes.request(frame);
    }

    prompt(message: string, options: { onEvent?(frame: Record<string, unknown>): void }): Promise<{ text: string; eventTypes: string[]; cancelled: boolean }> {
      return fakes.prompt(message, options);
    }

    onUiRequest(): () => void {
      return () => undefined;
    }

    dispose(): void {
      this.connected = false;
      fakes.dispose();
    }
  },
}));

import { OmpService } from "./omp-service";
import { discoverRuntime } from "./omp-runtime";

describe("OmpService startup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakes.prompt.mockResolvedValue({ text: "", eventTypes: [], cancelled: false });
    fakes.request.mockImplementation(async (frame) => frame.type === "get_state"
      ? {
          isStreaming: false,
          isCompacting: false,
          sessionId: "session",
          autoCompactionEnabled: true,
          tokensPerSecond: null,
          messageCount: 0,
          queuedMessageCount: 0,
        }
      : { models: [] });
  });

  it("shares one RPC startup across concurrent initial state and model requests", async () => {
    let releaseStart = () => undefined;
    fakes.start.mockImplementation(() => new Promise<void>((resolve) => {
      releaseStart = resolve;
    }));
    const service = new OmpService({
      appRoot: "/tmp/mahiko",
      getSettings: async () => ({ projectPath: "/tmp/project", theme: "dark", ompExecutableOverride: "" }),
      accountPoolPath: "/tmp/nonexistent-mahiko-account-pool.json",
      onUiRequest: () => undefined,
      openExternal: async () => undefined,
    });

    const state = service.getState();
    const models = service.getModels();
    await vi.waitFor(() => expect(fakes.start).toHaveBeenCalledTimes(1));
    releaseStart();

    await expect(Promise.all([state, models])).resolves.toEqual([
      expect.objectContaining({ sessionId: "session" }),
      [],
    ]);
    expect(fakes.start).toHaveBeenCalledTimes(1);
    expect(fakes.dispose).not.toHaveBeenCalled();
  });

  it("reuses runtime verification for sequential calls on the connected RPC client", async () => {
    fakes.start.mockResolvedValue(undefined);
    const service = new OmpService({
      appRoot: "/tmp/mahiko",
      getSettings: async () => ({ projectPath: "/tmp/project", theme: "dark", ompExecutableOverride: "" }),
      accountPoolPath: "/tmp/nonexistent-mahiko-account-pool.json",
      onUiRequest: () => undefined,
      openExternal: async () => undefined,
    });

    await service.getState();
    await service.getModels();

    expect(discoverRuntime).toHaveBeenCalledTimes(1);
    expect(fakes.start).toHaveBeenCalledTimes(1);
    service.dispose();
  });

  it("allows first-run custom provider setup after version verification even when RPC is not ready yet", async () => {
    const directory = await mkdtemp(join(process.cwd(), ".mahiko-test-provider-"));
    const executable = join(directory, "omp");
    const agentDirectory = join(directory, "agent");
    await writeFile(executable, `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args[0] === "config" && args[1] === "path") fs.writeSync(1, ${JSON.stringify(agentDirectory)} + "\\n");
else if (args[0] === "models") fs.writeSync(1, JSON.stringify({ models: [{ selector: "local/test-model" }] }) + "\\n");
`, "utf8");
    await chmod(executable, 0o755);
    vi.mocked(discoverRuntime).mockResolvedValueOnce({
      executable,
      compatible: true,
      version: "17.2.9",
      versionCheck: { ok: true, detail: "version ok" },
      integrity: { checked: false, ok: null, detail: "external" },
      rpc: { ready: false, mode: null, protocolVersion: null, supportedProtocolVersions: [], detail: "No models available", failureStage: "runtime" },
    } as never);
    const service = new OmpService({
      appRoot: "/tmp/mahiko",
      getSettings: async () => ({ projectPath: directory, theme: "dark", ompExecutableOverride: executable }),
      accountPoolPath: join(directory, "account-pool.json"),
      onUiRequest: () => undefined,
      openExternal: async () => undefined,
    });

    try {
      await expect(service.saveCustomProvider({
        providerId: "local",
        baseUrl: "http://127.0.0.1:11434/v1",
        api: "openai-completions",
        auth: "none",
        modelId: "test-model",
      })).resolves.toMatchObject({ ok: true, selector: "local/test-model" });
      expect(JSON.parse(await readFile(join(agentDirectory, "models.yml"), "utf8"))).toMatchObject({
        providers: { local: { auth: "none", models: [{ id: "test-model" }] } },
      });
      expect(fakes.start).not.toHaveBeenCalled();
    } finally {
      service.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("waits for OMP to expose the selected model instead of rejecting stale state", async () => {
    fakes.start.mockResolvedValue(undefined);
    const selected = { provider: "openai-codex", id: "gpt-5.6-luna", name: "GPT-5.6-Luna", contextWindow: 272_000, maxTokens: 128_000, reasoning: true, thinkingLevels: [], supportsThinkingOff: true };
    let stateReads = 0;
    fakes.request.mockImplementation(async (frame) => {
      if (frame.type === "set_model") return { ok: true };
      if (frame.type === "get_state") {
        stateReads += 1;
        return {
          model: stateReads === 1 ? { ...selected, id: "gpt-5.6-terra", name: "GPT-5.6-Terra" } : selected,
          isStreaming: false,
          isCompacting: false,
          sessionId: "session",
          autoCompactionEnabled: true,
          tokensPerSecond: null,
          messageCount: 0,
          queuedMessageCount: 0,
        };
      }
      return {};
    });
    const service = new OmpService({
      appRoot: "/tmp/mahiko",
      getSettings: async () => ({ projectPath: "/tmp/project", theme: "dark", ompExecutableOverride: "" }),
      accountPoolPath: "/tmp/nonexistent-mahiko-account-pool.json",
      onUiRequest: () => undefined,
      openExternal: async () => undefined,
    });

    await expect(service.setModel(selected.provider, selected.id)).resolves.toEqual(selected);
    expect(stateReads).toBe(2);
    expect(discoverRuntime).toHaveBeenCalledTimes(1);
    service.dispose();
  });

  it("atomically stores a normalized 0600 account pool and resets an active client", async () => {
    fakes.start.mockResolvedValue(undefined);
    const directory = await mkdtemp(join(tmpdir(), "mahiko-account-pool-"));
    const accountPoolPath = join(directory, "state", "omp-account-pool.json");
    const service = new OmpService({
      appRoot: "/tmp/mahiko",
      getSettings: async () => ({ projectPath: "/tmp/project", theme: "dark", ompExecutableOverride: "" }),
      accountPoolPath,
      onUiRequest: () => undefined,
      openExternal: async () => undefined,
    });

    try {
      await service.getModels();
      const snapshot = await service.setAccountPool({ antigravity: ["account:one", "account:one", "account:two"] });

      expect(snapshot).toEqual({
        configured: true,
        filePath: accountPoolPath,
        value: { antigravity: ["account:one", "account:two"] },
        requiresRestart: true,
      });
      expect(JSON.parse(await readFile(accountPoolPath, "utf8"))).toEqual(snapshot.value);
      expect((await stat(accountPoolPath)).mode & 0o777).toBe(0o600);
      expect(fakes.dispose).toHaveBeenCalledOnce();
    } finally {
      service.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("forwards only provider-visible thinking blocks from OMP message events", async () => {
    fakes.start.mockResolvedValue(undefined);
    fakes.prompt.mockImplementation(async (_message, options) => {
      options.onEvent?.({ type: "message_update", assistantMessageEvent: { type: "thinking_start", contentIndex: 2 } });
      options.onEvent?.({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", contentIndex: 2, delta: "Проверяю числа" } });
      options.onEvent?.({ type: "message_update", assistantMessageEvent: { type: "thinking_end", contentIndex: 2, content: "Проверяю числа." } });
      return { text: "323", eventTypes: ["message_update", "agent_end"], cancelled: false };
    });
    const service = new OmpService({
      appRoot: "/tmp/mahiko",
      getSettings: async () => ({ projectPath: "/tmp/project", theme: "dark", ompExecutableOverride: "" }),
      accountPoolPath: "/tmp/nonexistent-mahiko-account-pool.json",
      onUiRequest: () => undefined,
      openExternal: async () => undefined,
    });
    const events: unknown[] = [];

    await service.runAgent("thinking-run", "Вычисли 17 * 19", (event) => events.push(event));

    expect(events).toEqual([
      { runId: "thinking-run", type: "started" },
      { runId: "thinking-run", type: "thinking_start", contentIndex: 2 },
      { runId: "thinking-run", type: "thinking_delta", contentIndex: 2, delta: "Проверяю числа" },
      { runId: "thinking-run", type: "thinking_end", contentIndex: 2, content: "Проверяю числа." },
      { runId: "thinking-run", type: "completed", text: "323", observedEventTypes: ["message_update", "agent_end"] },
    ]);
    service.dispose();
  });

  it("exposes only OMP-declared thinking controls to the renderer", async () => {
    fakes.start.mockResolvedValue(undefined);
    fakes.request.mockResolvedValue({
      models: [{
        provider: "google",
        id: "gemini-3.1-pro",
        name: "Gemini 3.1 Pro",
        contextWindow: 1_000_000,
        maxTokens: 65_536,
        reasoning: true,
        thinking: { mode: "google-level", efforts: ["low", "medium", "high", "unsupported"], requiresEffort: true },
        headers: { Authorization: "must-not-cross-preload" },
      }],
    });
    const service = new OmpService({
      appRoot: "/tmp/mahiko",
      getSettings: async () => ({ projectPath: "/tmp/project", theme: "dark", ompExecutableOverride: "" }),
      accountPoolPath: "/tmp/nonexistent-mahiko-account-pool.json",
      onUiRequest: () => undefined,
      openExternal: async () => undefined,
    });

    await expect(service.getModels()).resolves.toEqual([{
      provider: "google",
      id: "gemini-3.1-pro",
      name: "Gemini 3.1 Pro",
      contextWindow: 1_000_000,
      maxTokens: 65_536,
      reasoning: true,
      thinkingLevels: ["low", "medium", "high"],
      supportsThinkingOff: false,
    }]);
    service.dispose();
  });

  it("accepts OMP auto thinking when get_state reports its concrete provisional effort", async () => {
    fakes.start.mockResolvedValue(undefined);
    fakes.request.mockImplementation(async (frame) => frame.type === "get_state"
      ? {
          thinkingLevel: "high",
          isStreaming: false,
          isCompacting: false,
          sessionId: "session",
          autoCompactionEnabled: true,
          tokensPerSecond: null,
          messageCount: 0,
          queuedMessageCount: 0,
        }
      : { ok: true });
    const service = new OmpService({
      appRoot: "/tmp/mahiko",
      getSettings: async () => ({ projectPath: "/tmp/project", theme: "dark", ompExecutableOverride: "" }),
      accountPoolPath: "/tmp/nonexistent-mahiko-account-pool.json",
      onUiRequest: () => undefined,
      openExternal: async () => undefined,
    });

    await expect(service.setThinkingLevel("auto")).resolves.toEqual({ ok: true, message: "Thinking level: auto" });
    service.dispose();
  });
});
