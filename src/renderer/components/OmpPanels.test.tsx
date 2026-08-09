import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OmpInstallationSnapshot, RuntimeSnapshot } from "../../shared/contracts";
import { api } from "../api";
import "../styles.css";
import { OmpBootstrapOverlay, OmpSetupOverlay } from "./OmpPanels";

const readyRuntime: RuntimeSnapshot = {
  checkedAt: new Date(0).toISOString(),
  executable: "/usr/bin/omp",
  expectedVersion: "17.2.9",
  version: "17.2.9",
  available: true,
  compatible: true,
  versionCheck: { ok: true, code: "ok", path: "/usr/bin/omp", expectedVersion: "17.2.9", foundVersion: "17.2.9", exitCode: 0, detail: "test fixture" },
  integrity: { checked: false, ok: null, path: "/usr/bin/omp", expectedSha256: null, actualSha256: null, detail: "external fixture" },
  rpc: { ready: true, protocolVersion: 2, supportedProtocolVersions: [1, 2], mode: "rpc-ui", detail: "test fixture" },
};

const coldStartFailure: RuntimeSnapshot = {
  ...readyRuntime,
  executable: "/opt/mahiko/resources/omp/omp",
  rpc: {
    ready: false,
    protocolVersion: null,
    supportedProtocolVersions: [],
    mode: null,
    attemptedMode: "rpc-ui",
    failureStage: "readiness",
    errorCode: "readiness-timeout",
    detail: "OMP rpc-ui RPC readiness timed out after 45000 ms: createAgentSession > resolveModelDiscoveryFallback",
  },
};

afterEach(() => vi.restoreAllMocks());

describe("OmpBootstrapOverlay", () => {
  it.each([
    ["Linux", "/home/test/.bun/bin/omp"],
    ["Windows", "C:\\Users\\test\\AppData\\Local\\omp\\omp.exe"],
  ])("allows the %s compatible external OMP action to receive a real pointer click", async (_platform, installedPath) => {
    const user = userEvent.setup();
    const onInstall = vi.fn();
    const snapshot: OmpInstallationSnapshot = {
      checkedAt: new Date(0).toISOString(),
      expectedVersion: "17.2.9",
      assetUrl: "https://github.com/can1357/oh-my-pi/releases/download/v17.2.9/omp-linux-x64",
      expectedSha256: "a".repeat(64),
      managedPath: installedPath.endsWith(".exe") ? "C:\\Users\\test\\AppData\\Local\\omp\\omp.exe" : "/home/test/.local/bin/omp",
      managedVersion: null,
      managedSha256: null,
      managedVersionCheck: { ok: false, code: "ENOENT", path: "/missing/managed-omp", expectedVersion: "17.2.9", foundVersion: null, exitCode: null, detail: "missing" },
      managedIntegrity: { checked: true, ok: false, path: "/missing/managed-omp", expectedSha256: "a".repeat(64), actualSha256: null, detail: "missing" },
      managedReady: false,
      external: { path: installedPath, version: "17.2.9", source: "path", versionCheck: { ok: true, code: "ok", path: installedPath, expectedVersion: "17.2.9", foundVersion: "17.2.9", exitCode: 0, detail: "test fixture" } },
      selectedPath: installedPath,
      dataLocations: [],
      detail: "Найден OMP 17.2.9",
    };

    render(<OmpBootstrapOverlay snapshot={snapshot} busy={false} error="" onInstall={onInstall} onExit={vi.fn()} />);
    const replace = screen.getByRole("button", { name: "Использовать OMP 17.2.9" });

    expect(getComputedStyle(replace).pointerEvents).toBe("auto");
    await user.click(replace);
    expect(onInstall).toHaveBeenCalledOnce();
  });

  it("requires an explicit click before downloading the official OMP", async () => {
    const user = userEvent.setup();
    const onInstall = vi.fn();
    const snapshot: OmpInstallationSnapshot = {
      checkedAt: new Date(0).toISOString(), expectedVersion: "17.2.9",
      assetUrl: "https://github.com/can1357/oh-my-pi/releases/download/v17.2.9/omp-linux-x64",
      expectedSha256: "a".repeat(64), managedPath: "/home/test/.local/bin/omp",
      managedVersion: null, managedSha256: null,
      managedVersionCheck: { ok: false, code: "ENOENT", path: "/home/test/.local/bin/omp", expectedVersion: "17.2.9", foundVersion: null, exitCode: null, detail: "missing" },
      managedIntegrity: { checked: true, ok: false, path: "/home/test/.local/bin/omp", expectedSha256: "a".repeat(64), actualSha256: null, detail: "missing" },
      managedReady: false, external: null, selectedPath: null, dataLocations: [], detail: "Совместимый OMP не найден",
    };

    render(<OmpBootstrapOverlay snapshot={snapshot} busy={false} error="" onInstall={onInstall} onExit={vi.fn()} />);
    expect(onInstall).not.toHaveBeenCalled();
    expect(screen.getByText(/команда omp будет доступна в терминале/i)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Установить OMP 17.2.9 как CLI" }));
    expect(onInstall).toHaveBeenCalledOnce();
  });
});

describe("OmpSetupOverlay", () => {
  it("does not show the removed OMP provider explanatory subtitle", () => {
    vi.spyOn(api.omp, "getLoginProviders").mockResolvedValue([]);
    render(<OmpSetupOverlay runtime={readyRuntime} onClose={vi.fn()} onComplete={vi.fn()} onRetryRuntime={vi.fn()} />);
    expect(screen.queryByText("Подключение провайдеров, регистрация и пулы аккаунтов работают через OMP.")).not.toBeInTheDocument();
  });

  it("loads and saves the observed account pool without seeded identities", async () => {
    const user = userEvent.setup();
    vi.spyOn(api.omp, "getLoginProviders").mockResolvedValue([]);
    vi.spyOn(api.omp, "getAccountPool").mockResolvedValue({
      configured: true,
      filePath: "/tmp/omp-account-pool.json",
      value: { antigravity: ["account:one", "account:two"] },
      requiresRestart: false,
    });
    const setAccountPool = vi.spyOn(api.omp, "setAccountPool").mockResolvedValue({
      configured: true,
      filePath: "/tmp/omp-account-pool.json",
      value: { antigravity: ["account:one", "account:three"] },
      requiresRestart: true,
    });

    render(<OmpSetupOverlay runtime={readyRuntime} onClose={vi.fn()} onComplete={vi.fn()} onRetryRuntime={vi.fn()} />);
    await user.click(screen.getByRole("tab", { name: "Аккаунты" }));

    expect(await screen.findByDisplayValue("antigravity")).toBeVisible();
    const identities = screen.getByRole("textbox", { name: "Identity" });
    expect(identities).toHaveValue("account:one\naccount:two");
    await user.clear(identities);
    await user.type(identities, "account:one{enter}account:three");
    await user.click(screen.getByRole("button", { name: "Сохранить пул" }));

    await waitFor(() => expect(setAccountPool).toHaveBeenCalledWith({ antigravity: ["account:one", "account:three"] }));
    expect(screen.getByText(/OMP будет перезапущен/i)).toBeVisible();
    expect(screen.queryByDisplayValue("account:primary")).not.toBeInTheDocument();
  });

  it("starts the real provider login flow and refreshes authentication state", async () => {
    const user = userEvent.setup();
    vi.spyOn(api.omp, "getAccountPool").mockResolvedValue({ configured: false, filePath: "/tmp/omp-account-pool.json", value: {}, requiresRestart: false });
    const getLoginProviders = vi.spyOn(api.omp, "getLoginProviders")
      .mockResolvedValueOnce([{ id: "antigravity", name: "Antigravity", available: true, authenticated: false }])
      .mockResolvedValueOnce([{ id: "antigravity", name: "Antigravity", available: true, authenticated: true }]);
    const login = vi.spyOn(api.omp, "login").mockResolvedValue({ ok: true, message: "Antigravity подключён" });

    render(<OmpSetupOverlay runtime={readyRuntime} onClose={vi.fn()} onComplete={vi.fn()} onRetryRuntime={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: "Подключить Antigravity" }));
    await waitFor(() => expect(login).toHaveBeenCalledWith("antigravity"));
    expect(await screen.findByRole("button", { name: "Переподключить Antigravity" })).toBeVisible();
    expect(getLoginProviders).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Antigravity подключён")).toBeVisible();
  });

  it("reports an RPC OAuth cancellation as a cancelled login instead of a version or timeout error", async () => {
    const user = userEvent.setup();
    vi.spyOn(api.omp, "getAccountPool").mockResolvedValue({ configured: false, filePath: "/tmp/omp-account-pool.json", value: {}, requiresRestart: false });
    vi.spyOn(api.omp, "getLoginProviders").mockResolvedValue([{ id: "anthropic", name: "Anthropic", available: true, authenticated: false }]);
    vi.spyOn(api.omp, "login").mockRejectedValue(new Error("OAuth callback cancelled: TimeoutError: The operation timed out."));

    render(<OmpSetupOverlay runtime={readyRuntime} onClose={vi.fn()} onComplete={vi.fn()} onRetryRuntime={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: "Подключить Anthropic" }));

    expect(await screen.findByText("Вход отменён.")).toBeVisible();
    expect(screen.queryByText(/Ошибка авторизации|TimeoutError/i)).not.toBeInTheDocument();
  });

  it("saves a custom provider through the real OMP API", async () => {
    const user = userEvent.setup();
    vi.spyOn(api.omp, "getAccountPool").mockResolvedValue({ configured: false, filePath: "/tmp/omp-account-pool.json", value: {}, requiresRestart: false });
    vi.spyOn(api.omp, "getLoginProviders").mockResolvedValue([]);
    const saveCustomProvider = vi.spyOn(api.omp, "saveCustomProvider").mockResolvedValue({ ok: true, message: "Провайдер сохранён", selector: "kult/model" });

    render(<OmpSetupOverlay runtime={readyRuntime} onClose={vi.fn()} onComplete={vi.fn()} onRetryRuntime={vi.fn()} />);
    await user.click(screen.getByRole("tab", { name: "Custom API" }));
    await user.type(screen.getByLabelText("Provider id"), "kult");
    await user.type(screen.getByLabelText("Base URL"), "https://example.com/v1");
    await user.selectOptions(screen.getByLabelText("Credential"), "api-key");
    await user.type(screen.getByLabelText("API key"), "secret-test-key");
    await user.type(screen.getByLabelText("Model id"), "model");
    await user.type(screen.getByLabelText("Название"), "Test Model");
    await user.click(screen.getByRole("button", { name: "Сохранить и проверить" }));

    await waitFor(() => expect(saveCustomProvider).toHaveBeenCalledWith({
      providerId: "kult",
      baseUrl: "https://example.com/v1",
      api: "openai-responses",
      apiKey: "secret-test-key",
      auth: "api-key",
      modelId: "model",
      modelName: "Test Model",
    }));
    expect(screen.getByText("Провайдер сохранён")).toBeVisible();
  });

  it("shows startup state without requesting or claiming an empty provider list before runtime readiness", () => {
    const getLoginProviders = vi.spyOn(api.omp, "getLoginProviders");
    render(<OmpSetupOverlay runtime={null} onClose={vi.fn()} onComplete={vi.fn()} onRetryRuntime={vi.fn()} />);

    expect(screen.getByText("OMP запускается…")).toBeVisible();
    expect(screen.queryByText("OMP не сообщил доступных провайдеров.")).not.toBeInTheDocument();
    expect(getLoginProviders).not.toHaveBeenCalled();
  });

  it("shows the exact readiness error and executable path instead of an empty provider list", () => {
    const getLoginProviders = vi.spyOn(api.omp, "getLoginProviders");
    render(<OmpSetupOverlay runtime={coldStartFailure} onClose={vi.fn()} onComplete={vi.fn()} onRetryRuntime={vi.fn()} />);

    expect(screen.getByText(coldStartFailure.rpc.detail)).toBeVisible();
    expect(screen.getByText("Стадия: readiness · readiness-timeout")).toBeVisible();
    expect(screen.getByText("/opt/mahiko/resources/omp/omp")).toBeVisible();
    expect(screen.queryByText("OMP не сообщил доступных провайдеров.")).not.toBeInTheDocument();
    expect(getLoginProviders).not.toHaveBeenCalled();
  });

  it("shows the checked Windows OMP path when executable discovery returned null", () => {
    const windowsPath = "C:\\Users\\Alice\\AppData\\Local\\omp\\omp.exe";
    const missingRuntime: RuntimeSnapshot = {
      ...coldStartFailure,
      executable: null,
      available: false,
      compatible: false,
      versionCheck: {
        ok: false,
        code: "ENOENT",
        path: windowsPath,
        expectedVersion: "17.2.9",
        foundVersion: null,
        exitCode: null,
        detail: `OMP не найден: ${windowsPath}`,
      },
      rpc: { ...coldStartFailure.rpc, failureStage: "version", errorCode: undefined, detail: `RPC не запускался: OMP не найден: ${windowsPath}` },
    };
    render(<OmpSetupOverlay runtime={missingRuntime} onClose={vi.fn()} onComplete={vi.fn()} onRetryRuntime={vi.fn()} />);

    expect(screen.getByText("Стадия: version")).toBeVisible();
    expect(screen.getByText(windowsPath)).toBeVisible();
    expect(screen.queryByText("OMP не сообщил доступных провайдеров.")).not.toBeInTheDocument();
  });

  it("shows an empty state only after a successful empty provider response", async () => {
    vi.spyOn(api.omp, "getLoginProviders").mockResolvedValue([]);
    render(<OmpSetupOverlay runtime={readyRuntime} onClose={vi.fn()} onComplete={vi.fn()} onRetryRuntime={vi.fn()} />);

    expect(await screen.findByText("OMP не сообщил доступных провайдеров.")).toBeVisible();
  });

  it("renders provider rows after a successful non-empty response", async () => {
    vi.spyOn(api.omp, "getLoginProviders").mockResolvedValue([
      { id: "openai-codex", name: "OpenAI Codex", available: true, authenticated: false },
      { id: "anthropic", name: "Anthropic", available: true, authenticated: true },
    ]);
    render(<OmpSetupOverlay runtime={readyRuntime} onClose={vi.fn()} onComplete={vi.fn()} onRetryRuntime={vi.fn()} />);

    expect(await screen.findByText("OpenAI Codex")).toBeVisible();
    expect(screen.getByText("Anthropic")).toBeVisible();
    expect(screen.queryByText("OMP не сообщил доступных провайдеров.")).not.toBeInTheDocument();
  });

  it("rechecks runtime and loads providers after a temporary startup timeout", async () => {
    const user = userEvent.setup();
    const getLoginProviders = vi.spyOn(api.omp, "getLoginProviders").mockResolvedValue([
      { id: "openai-codex", name: "OpenAI Codex", available: true, authenticated: false },
    ]);
    let view: ReturnType<typeof render>;
    const onRetryRuntime = vi.fn(async () => {
      view.rerender(<OmpSetupOverlay runtime={readyRuntime} onClose={vi.fn()} onComplete={vi.fn()} onRetryRuntime={onRetryRuntime} />);
    });
    view = render(<OmpSetupOverlay runtime={coldStartFailure} onClose={vi.fn()} onComplete={vi.fn()} onRetryRuntime={onRetryRuntime} />);

    await user.click(screen.getByRole("button", { name: "Повторить" }));
    expect(await screen.findByText("OpenAI Codex")).toBeVisible();
    expect(onRetryRuntime).toHaveBeenCalledOnce();
    expect(getLoginProviders).toHaveBeenCalledOnce();
  });
});
