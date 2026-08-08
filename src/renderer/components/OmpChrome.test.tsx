import { useState, type JSX } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { OmpModel, OmpSessionState, RuntimeSnapshot } from "../../shared/contracts";
import { Composer, type ComposerOverlay, type ThinkingLevel } from "./OmpChrome";

const models: OmpModel[] = [
  { provider: "openai", id: "gpt-5.6-sol", name: "GPT-5.6 Sol", contextWindow: 1_100_000, maxTokens: 64_000, reasoning: true, thinkingLevels: ["minimal", "low", "medium", "high", "xhigh", "max"], supportsThinkingOff: true },
  { provider: "anthropic", id: "claude-opus", name: "Claude Opus", contextWindow: 200_000, maxTokens: 32_000, reasoning: true, thinkingLevels: ["low", "medium", "high"], supportsThinkingOff: false },
];

const readyRuntime: RuntimeSnapshot = {
  checkedAt: new Date(0).toISOString(),
  executable: "/usr/bin/omp",
  expectedVersion: "17.2.9",
  version: "17.2.9",
  available: true,
  compatible: true,
  rpc: { ready: true, protocolVersion: 2, supportedProtocolVersions: [1, 2], mode: "rpc-ui", detail: "test fixture" },
};

function stateFor(model = models[0], thinkingLevel: ThinkingLevel = "xhigh", autoCompactionEnabled = true): OmpSessionState {
  return {
    model,
    thinkingLevel,
    isStreaming: false,
    isCompacting: false,
    sessionId: "session-1",
    autoCompactionEnabled,
    tokensPerSecond: null,
    messageCount: 2,
    queuedMessageCount: 0,
    contextUsage: { tokens: 20_900, contextWindow: 1_100_000, percent: 1.9 },
  };
}

function ComposerHarness({ onCommand = vi.fn(), working = false }: { onCommand?(command: string): void; working?: boolean }): JSX.Element {
  const [value, setValue] = useState("");
  const [selected, setSelected] = useState(models[0]);
  const [thinking, setThinking] = useState<ThinkingLevel>("xhigh");
  const [overlay, setOverlay] = useState<ComposerOverlay>(null);
  const [autoCompact, setAutoCompact] = useState(true);
  return (
    <Composer
      value={value}
      onChange={setValue}
      onSubmit={vi.fn()}
      working={working}
      projectName="mahiko"
      runtime={readyRuntime}
      sessionState={stateFor(selected, thinking, autoCompact)}
      models={models}
      onCommand={onCommand}
      overlay={overlay}
      onOverlayChange={setOverlay}
      onSelectModel={setSelected}
      onSelectThinking={setThinking}
      onToggleAutoCompact={setAutoCompact}
      onCompactNow={vi.fn()}
      onChooseProject={vi.fn()}
      onRefreshRuntime={vi.fn()}
    />
  );
}

describe("OMP composer chrome", () => {
  it("рисует только thinking levels, объявленные выбранной моделью OMP", () => {
    render(
      <Composer
        value=""
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        working={false}
        projectName="mahiko"
        runtime={readyRuntime}
        sessionState={stateFor(models[1], "high")}
        models={models}
        onCommand={vi.fn()}
        overlay="reasoning"
        onOverlayChange={vi.fn()}
        onSelectModel={vi.fn()}
        onSelectThinking={vi.fn()}
        onToggleAutoCompact={vi.fn()}
        onCompactNow={vi.fn()}
      />,
    );

    const reasoning = screen.getByRole("listbox", { name: "Уровень рассуждения OMP" });
    expect(within(reasoning).getByRole("option", { name: /auto/ })).toBeVisible();
    expect(within(reasoning).getByRole("option", { name: /^low/ })).toBeVisible();
    expect(within(reasoning).getByRole("option", { name: /^medium/ })).toBeVisible();
    expect(within(reasoning).getByRole("option", { name: /^high/ })).toBeVisible();
    expect(within(reasoning).queryByRole("option", { name: /^off/ })).not.toBeInTheDocument();
    expect(within(reasoning).queryByRole("option", { name: /^minimal/ })).not.toBeInTheDocument();
    expect(within(reasoning).queryByRole("option", { name: /^xhigh/ })).not.toBeInTheDocument();
    expect(within(reasoning).queryByRole("option", { name: /^max/ })).not.toBeInTheDocument();
  });

  it("показывает интерактивный reasoning chooser, точный context status и взаимно исключает popover-ы", async () => {
    const user = userEvent.setup();
    render(<ComposerHarness />);

    expect(screen.getByText("◫ 1.9%/1.1M")).toBeVisible();
    const modelTrigger = screen.getByRole("button", { name: "Выбрать модель: GPT-5.6 Sol" });
    const thinkingTrigger = screen.getByRole("button", { name: "Выбрать уровень рассуждения: xhigh" });
    const contextTrigger = screen.getByRole("button", { name: /Открыть контекст/i });

    await user.click(modelTrigger);
    expect(screen.getByRole("listbox", { name: "Выбор модели OMP" })).toBeVisible();
    await user.click(thinkingTrigger);
    expect(screen.queryByRole("listbox", { name: "Выбор модели OMP" })).not.toBeInTheDocument();

    const reasoning = screen.getByRole("listbox", { name: "Уровень рассуждения OMP" });
    expect(reasoning).toHaveFocus();
    await user.keyboard("{ArrowDown}{Enter}");
    await waitFor(() => expect(screen.getByRole("button", { name: "Выбрать уровень рассуждения: max" })).toHaveFocus());

    await user.click(contextTrigger);
    expect(screen.queryByRole("listbox", { name: "Уровень рассуждения OMP" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Контекст OMP")).toBeVisible();
    expect(screen.getByRole("button", { name: "Автосжатие" })).toBeVisible();
    await user.keyboard("{Escape}");
    expect(screen.queryByLabelText("Контекст OMP")).not.toBeInTheDocument();
    await waitFor(() => expect(contextTrigger).toHaveFocus());
  });

  it("перемещается по компактному model picker и Escape возвращает фокус", async () => {
    const user = userEvent.setup();
    render(<ComposerHarness />);

    const trigger = screen.getByRole("button", { name: "Выбрать модель: GPT-5.6 Sol" });
    await user.click(trigger);
    const list = screen.getByRole("listbox", { name: "Выбор модели OMP" });
    expect(list).toHaveFocus();
    expect(list).toHaveClass("composer-popover", "model-popover");
    await user.keyboard("{ArrowDown}{Enter}");
    await waitFor(() => expect(screen.getByRole("button", { name: "Выбрать модель: Claude Opus" })).toHaveFocus());

    await user.click(screen.getByRole("button", { name: "Выбрать модель: Claude Opus" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox", { name: "Выбор модели OMP" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Выбрать модель: Claude Opus" })).toHaveFocus());
  });

  it("оставляет compact локальным и отключает недоступную RPC-команду", async () => {
    const user = userEvent.setup();
    const toggleAuto = vi.fn();
    const compactNow = vi.fn();
    render(
      <Composer
        value="Проверка"
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        working={false}
        projectName="mahiko"
        runtime={{ ...readyRuntime, compatible: false, rpc: { ...readyRuntime.rpc, ready: false } }}
        sessionState={stateFor()}
        models={models}
        onCommand={vi.fn()}
        overlay="context"
        onOverlayChange={vi.fn()}
        onSelectModel={vi.fn()}
        onSelectThinking={vi.fn()}
        onToggleAutoCompact={toggleAuto}
        onCompactNow={compactNow}
      />,
    );

    expect(screen.getByLabelText("Контекст OMP")).toBeVisible();
    expect(screen.getByRole("button", { name: /Сжать сейчас/i })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /Автосжатие/i }));
    await user.click(screen.getByRole("button", { name: /Сжать сейчас/i }));
    expect(toggleAuto).toHaveBeenCalledWith(false);
    expect(compactNow).not.toHaveBeenCalled();
  });

  it("выбирает slash-команду и блокирует input во время работы", async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn();
    const { rerender } = render(<ComposerHarness onCommand={onCommand} />);
    const input = screen.getByRole("textbox", { name: "Сообщение mahiko" });

    await user.type(input, "/");
    expect(screen.getByRole("listbox", { name: "Команды OMP" })).toBeVisible();
    await user.keyboard("{ArrowDown}{Enter}");
    expect(onCommand).toHaveBeenCalledWith("/settings");

    rerender(<ComposerHarness onCommand={onCommand} working />);
    expect(screen.getByRole("textbox", { name: "Сообщение mahiko" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /OMP работает/i })).not.toBeInTheDocument();
  });
});
