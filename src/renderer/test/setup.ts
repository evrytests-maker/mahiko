import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { defaultSettings, type AppSettings, type EmbeddedBrowserState, type MahikoApi, type OmpInstallationSnapshot, type OmpModel, type OmpSessionState, type RuntimeSnapshot } from "../../shared/contracts";

const testModels: OmpModel[] = [
  { provider: "openai", id: "gpt-5.6-sol", name: "GPT-5.6 Sol", contextWindow: 1_100_000, maxTokens: 64_000, reasoning: true, thinkingLevels: ["minimal", "low", "medium", "high", "xhigh", "max"], supportsThinkingOff: true },
  { provider: "anthropic", id: "claude-opus-4-6", name: "Claude Opus 4.6", contextWindow: 200_000, maxTokens: 32_000, reasoning: true, thinkingLevels: ["low", "medium", "high"], supportsThinkingOff: false },
];
const initialSettings = (): AppSettings => ({ ...defaultSettings, projectPath: "/tmp/mahiko-test", runtimeSetupComplete: true, onboardingComplete: true });
const initialSession = (): OmpSessionState => ({ model: testModels[0], thinkingLevel: "xhigh", isStreaming: false, isCompacting: false, sessionId: "test-session", autoCompactionEnabled: true, tokensPerSecond: null, messageCount: 0, queuedMessageCount: 0, contextUsage: { tokens: 20_900, contextWindow: 1_100_000, percent: 1.9 } });
const versionCheck = (path: string) => ({ ok: true as const, code: "ok" as const, path, expectedVersion: "17.2.9", foundVersion: "17.2.9", exitCode: 0, detail: "Ready" });
const runtimeSnapshot = (): RuntimeSnapshot => ({ checkedAt: new Date(0).toISOString(), executable: "/tmp/omp", expectedVersion: "17.2.9", version: "17.2.9", available: true, compatible: true, versionCheck: versionCheck("/tmp/omp"), integrity: { checked: false, ok: null, path: "/tmp/omp", expectedSha256: null, actualSha256: null, detail: "external fixture" }, rpc: { ready: true, mode: "rpc-ui", protocolVersion: 2, supportedProtocolVersions: [1, 2], detail: "Ready" } });
const installationSnapshot = (): OmpInstallationSnapshot => ({ checkedAt: new Date(0).toISOString(), expectedVersion: "17.2.9", expectedSha256: "a".repeat(64), bundledPath: "/tmp/bundled-omp", bundledVersion: "17.2.9", bundledSha256: "a".repeat(64), bundledVersionCheck: versionCheck("/tmp/bundled-omp"), bundledIntegrity: { checked: true, ok: true, path: "/tmp/bundled-omp", expectedSha256: "a".repeat(64), actualSha256: "a".repeat(64), detail: "Ready" }, bundledReady: true, installed: { path: "/tmp/omp", version: "17.2.9", versionCheck: versionCheck("/tmp/omp"), source: "path", replaceable: true }, dataLocations: ["/tmp/.omp"], detail: "Ready" });
const browserState: EmbeddedBrowserState = { url: "https://example.com/", title: "Example", loading: false, canGoBack: false, canGoForward: false, error: null };
let settings = initialSettings();
let session = initialSession();

afterEach(() => {
  cleanup();
  settings = initialSettings();
  session = initialSession();
});

if (typeof Element !== "undefined") Element.prototype.scrollTo = () => undefined;

if (typeof window !== "undefined" && !window.mahiko) {
  const unsupported = async (): Promise<never> => { throw new Error("Unsupported in renderer test fixture"); };
  const api: MahikoApi = {
    runtime: {
      getSnapshot: async () => runtimeSnapshot(),
      refresh: async () => runtimeSnapshot(),
      getInstallation: async () => installationSnapshot(),
      installBundled: async () => installationSnapshot(),
    },
    application: { quit: async () => undefined },
    project: {
      choose: async () => null,
      listFiles: async () => [{ path: "README.md", name: "README.md", kind: "file", depth: 0 }],
      readFile: async (path) => ({ path, content: "# Test project", truncated: false }),
    },
    settings: { get: async () => ({ ...settings }), update: async (patch) => (settings = { ...settings, ...patch }) },
    browser: {
      show: async (_bounds, url) => ({ ...browserState, url: url ?? browserState.url }),
      hide: async () => ({ ok: true, message: "hidden" }),
      setBounds: async () => ({ ok: true, message: "bounds" }),
      navigate: async (url) => ({ ...browserState, url }),
      back: async () => browserState, forward: async () => browserState, reload: async () => browserState,
      onState: () => () => undefined,
    },
    terminal: { run: async (command) => ({ command, cwd: "/tmp/mahiko-test", stdout: "/tmp/mahiko-test\n", stderr: "", exitCode: 0 }) },
    diagnostics: { get: unsupported, copy: unsupported },
    agent: { run: unsupported, cancel: async () => ({ ok: true, message: "cancelled" }), onEvent: () => () => undefined },
    omp: {
      getState: async () => ({ ...session }), getModels: async () => testModels,
      setModel: async (provider, modelId) => { const model = testModels.find((entry) => entry.provider === provider && entry.id === modelId) ?? testModels[0]!; session = { ...session, model }; return model; },
      setThinkingLevel: async (thinkingLevel) => { session = { ...session, thinkingLevel }; return { ok: true, message: "thinking" }; },
      setAutoCompaction: async (enabled) => { session = { ...session, autoCompactionEnabled: enabled }; return { ok: true, message: "auto" }; },
      compact: async () => ({ ok: true, message: "compact" }), getSubagents: async () => [], getSubagentSettings: async () => [], setConfig: unsupported,
      getLoginProviders: async () => [], login: unsupported, onUiRequest: () => () => undefined, respondUi: unsupported,
      getAccountPool: async () => ({ configured: false, filePath: "/tmp/none", value: {}, requiresRestart: false }), setAccountPool: unsupported, saveCustomProvider: unsupported,
    },
  };
  window.mahiko = api;
}
