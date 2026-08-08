import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimeSnapshot } from "../../shared/contracts";
import { api } from "../api";
import { OmpSetupOverlay } from "./OmpPanels";

const readyRuntime: RuntimeSnapshot = {
  checkedAt: new Date(0).toISOString(),
  executable: "/usr/bin/omp",
  expectedVersion: "17.2.9",
  version: "17.2.9",
  available: true,
  compatible: true,
  rpc: { ready: true, protocolVersion: 2, supportedProtocolVersions: [1, 2], mode: "rpc-ui", detail: "test fixture" },
};

afterEach(() => vi.restoreAllMocks());

describe("OmpSetupOverlay", () => {
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

    render(<OmpSetupOverlay runtime={readyRuntime} onClose={vi.fn()} onComplete={vi.fn()} />);
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

    render(<OmpSetupOverlay runtime={readyRuntime} onClose={vi.fn()} onComplete={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: "Подключить Antigravity" }));
    await waitFor(() => expect(login).toHaveBeenCalledWith("antigravity"));
    expect(await screen.findByRole("button", { name: "Переподключить Antigravity" })).toBeVisible();
    expect(getLoginProviders).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Antigravity подключён")).toBeVisible();
  });

  it("saves a custom provider through the real OMP API", async () => {
    const user = userEvent.setup();
    vi.spyOn(api.omp, "getAccountPool").mockResolvedValue({ configured: false, filePath: "/tmp/omp-account-pool.json", value: {}, requiresRestart: false });
    vi.spyOn(api.omp, "getLoginProviders").mockResolvedValue([]);
    const saveCustomProvider = vi.spyOn(api.omp, "saveCustomProvider").mockResolvedValue({ ok: true, message: "Провайдер сохранён", selector: "kult/model" });

    render(<OmpSetupOverlay runtime={readyRuntime} onClose={vi.fn()} onComplete={vi.fn()} />);
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
});
