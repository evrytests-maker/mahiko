import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AgentRunResult, OmpModel } from "../shared/contracts";
import { App } from "./App";

async function openSidebar(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Показать боковую панель" }));
  return screen.getByRole("complementary", { name: "Панель среды" });
}

async function openWorkbench(user: ReturnType<typeof userEvent.setup>) {
  const trigger = await screen.findByRole("button", { name: "Показать Coding Workbench" });
  await user.click(trigger);
  return screen.getByRole("complementary", { name: "Coding Workbench" });
}

describe("оболочка mahiko", () => {
  it("asks for consent when a previously configured OMP is no longer compatible", async () => {
    const originalSettings = window.mahiko!.settings.get;
    const originalRuntime = window.mahiko!.runtime.getSnapshot;
    const originalInstallation = window.mahiko!.runtime.getInstallation;
    const settings = await originalSettings();
    const runtime = await originalRuntime();
    const getInstallation = vi.fn(originalInstallation);
    window.mahiko!.settings.get = async () => ({ ...settings, runtimeSetupComplete: true });
    window.mahiko!.runtime.getSnapshot = async () => ({
      ...runtime,
      executable: null,
      available: false,
      compatible: false,
      version: null,
      versionCheck: { ok: false, code: "ENOENT", path: "/missing/omp", expectedVersion: "17.2.9", foundVersion: null, exitCode: null, detail: "OMP не найден" },
      rpc: { ready: false, mode: null, protocolVersion: null, supportedProtocolVersions: [], detail: "RPC не запускался", failureStage: "version" },
    });
    window.mahiko!.runtime.getInstallation = getInstallation;

    try {
      render(<App />);
      expect(await screen.findByRole("dialog", { name: "Первоначальная настройка OMP" })).toBeVisible();
      expect(getInstallation).toHaveBeenCalledOnce();
    } finally {
      window.mahiko!.settings.get = originalSettings;
      window.mahiko!.runtime.getSnapshot = originalRuntime;
      window.mahiko!.runtime.getInstallation = originalInstallation;
    }
  });

  it("показывает только реальные Workbench-инструменты и открывает файл проекта", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByText("Чем помочь?")).toBeVisible();
    const workbench = await openWorkbench(user);
    expect(within(workbench).queryByRole("tab", { name: /Review/ })).not.toBeInTheDocument();
    expect(within(workbench).getByRole("tab", { name: /Terminal/ })).toHaveAttribute("aria-selected", "true");

    const terminalInput = within(workbench).getByRole("textbox", { name: "Команда терминала" });
    await user.type(terminalInput, "pwd{Enter}");
    expect(await within(workbench).findByText("/tmp/mahiko-test")).toBeVisible();

    await user.click(within(workbench).getByRole("tab", { name: /Browser/ }));
    expect(within(workbench).getByRole("region", { name: "Browser" })).toBeVisible();

    await user.click(within(workbench).getByRole("tab", { name: /Files/ }));
    await user.click(within(workbench).getByRole("button", { name: "README.md" }));
    expect(await screen.findByRole("dialog", { name: "README.md" })).toBeVisible();
    expect(screen.getByText("# Test project")).toBeVisible();
  });

  it("открывает только наблюдаемое состояние проекта и отключает неподдерживаемые поверхности", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Чем помочь?");
    const sidebar = await openSidebar(user);

    for (const label of ["Изменения", "/MCP", "Скиллы", "Субагенты"]) {
      expect(within(sidebar).getByRole("button", { name: label })).toBeDisabled();
    }
    await user.click(within(sidebar).getByRole("button", { name: "Проекты" }));
    const project = screen.getByRole("dialog", { name: "Проект" });
    expect(within(project).getAllByText("/tmp/mahiko-test").length).toBeGreaterThan(0);
    expect(within(project).getByText(/OMP RPC 17\.2\.9 не предоставляет/)).toBeVisible();
  });

  it("назначает модель и reasoning через OMP API", async () => {
    const user = userEvent.setup();
    render(<App />);

    const modelTrigger = await screen.findByRole("button", { name: "Выбрать модель: GPT-5.6 Sol" });
    await user.click(modelTrigger);
    await user.click(screen.getByRole("option", { name: /Claude Opus 4\.6/ }));
    expect(await screen.findByRole("button", { name: "Выбрать модель: Claude Opus 4.6" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Выбрать уровень рассуждения: xhigh" }));
    await user.click(screen.getByRole("option", { name: /^high/i }));
    expect(await screen.findByRole("button", { name: "Выбрать уровень рассуждения: high" })).toBeVisible();
  });

  it("сразу отражает выбранную модель, пока OMP подтверждает переключение", async () => {
    const user = userEvent.setup();
    const originalSetModel = window.mahiko!.omp.setModel;
    const target: OmpModel = { provider: "anthropic", id: "claude-opus-4-6", name: "Claude Opus 4.6", contextWindow: 200_000, maxTokens: 32_000, reasoning: true, thinkingLevels: ["low", "medium", "high"], supportsThinkingOff: false };
    let resolveModel: ((model: OmpModel) => void) | undefined;
    window.mahiko!.omp.setModel = vi.fn(() => new Promise<OmpModel>((resolve) => { resolveModel = resolve; }));

    try {
      render(<App />);
      await user.click(await screen.findByRole("button", { name: "Выбрать модель: GPT-5.6 Sol" }));
      await user.click(screen.getByRole("option", { name: /Claude Opus 4\.6/ }));

      expect(screen.queryByRole("listbox", { name: "Выбор модели OMP" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Выбрать модель: Claude Opus 4.6" })).toBeVisible();
      expect(screen.getByText("Переключение на Claude Opus 4.6…")).toBeVisible();

      resolveModel?.(target);
      expect(await screen.findByText("Модель: Claude Opus 4.6")).toBeVisible();
    } finally {
      window.mahiko!.omp.setModel = originalSetModel;
    }
  });

  it("сохраняет тему и оставляет неподдерживаемые разделы настроек disabled", async () => {
    const user = userEvent.setup();
    render(<App />);

    const sidebar = await openSidebar(user);
    await user.click(within(sidebar).getByRole("button", { name: "Настройки OMP" }));
    const settings = screen.getByRole("dialog", { name: "Настройки OMP" });
    expect(within(settings).getByRole("tab", { name: "Вид" })).toBeEnabled();
    expect(within(settings).getByRole("tab", { name: "Модель" })).toBeDisabled();
    expect(within(settings).getByText(/RPC 17\.2\.9 не предоставляет/)).toBeVisible();

    const codex = within(settings).getByRole("button", { name: /Codex/ });
    await user.click(codex);
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("codex"));
  });

  it("не дублирует Working в composer и Esc вызывает настоящий cancel", async () => {
    const user = userEvent.setup();
    const originalRun = window.mahiko!.agent.run;
    const originalCancel = window.mahiko!.agent.cancel;
    let resolveRun: ((result: AgentRunResult) => void) | undefined;
    const cancel = vi.fn(async (runId: string) => {
      resolveRun?.({ runId, text: "", cancelled: true, observedEventTypes: ["agent_end"] });
      return { ok: true, message: "cancelled" };
    });
    window.mahiko!.agent.run = (prompt, runId) => new Promise<AgentRunResult>((resolve) => { resolveRun = resolve; });
    window.mahiko!.agent.cancel = cancel;

    try {
      render(<App />);
      const input = await screen.findByRole("textbox", { name: "Сообщение mahiko" });
      await user.type(input, "Проверка отмены{Enter}");
      expect(await screen.findByRole("button", { name: /Остановить/ })).toBeVisible();
      expect(screen.queryByRole("button", { name: /OMP работает/ })).not.toBeInTheDocument();
      await user.keyboard("{Escape}");
      await waitFor(() => expect(cancel).toHaveBeenCalledOnce());
      await waitFor(() => expect(screen.queryByRole("button", { name: /Остановить/ })).not.toBeInTheDocument());
      expect(screen.getAllByText("Запрос остановлен пользователем").length).toBeGreaterThan(0);
    } finally {
      window.mahiko!.agent.run = originalRun;
      window.mahiko!.agent.cancel = originalCancel;
    }
  });
});
