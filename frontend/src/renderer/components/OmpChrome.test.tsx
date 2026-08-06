import { useState, type JSX } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Composer, type ThinkingLevel } from "./OmpChrome";

function ComposerHarness({ onCommand = vi.fn(), working = false }: { onCommand?(command: string): void; working?: boolean }): JSX.Element {
  const [value, setValue] = useState("");
  const [model, setModel] = useState<[string, string]>(["GPT-5.6 Sol", "a6api:gpt-5.6-sol"]);
  const [modelOpen, setModelOpen] = useState(false);
  const [thinking, setThinking] = useState<ThinkingLevel>("xhigh");
  const [compact, setCompact] = useState(false);
  return (
    <Composer
      value={value}
      onChange={setValue}
      onSubmit={vi.fn()}
      working={working}
      projectName="ma-hi-ko"
      runtime={null}
      onCommand={onCommand}
      selectedModel={model[0]}
      selectedModelKey={model[1]}
      modelPickerOpen={modelOpen}
      onToggleModelPicker={() => setModelOpen((open) => !open)}
      onSelectModel={(label, key) => { setModel([label, key]); setModelOpen(false); }}
      selectedThinking={thinking}
      onSelectThinking={setThinking}
      contextCompact={compact}
      onContextCompactChange={setCompact}
      onChooseProject={vi.fn()}
      onRefreshRuntime={vi.fn()}
    />
  );
}

describe("интерактивная строка OMP", () => {
  it("меняет рассуждение и вызывает действия проекта, контекста и среды", async () => {
    const user = userEvent.setup();
    const chooseProject = vi.fn();
    const refreshRuntime = vi.fn();
    const submit = vi.fn();

    render(
      <Composer
        value="Проверка"
        onChange={vi.fn()}
        onSubmit={submit}
        working={false}
        projectName="ma-hi-ko"
        runtime={null}
        onCommand={vi.fn()}
        selectedModel="GPT-5.6 Sol"
        selectedModelKey="a6api:gpt-5.6-sol"
        modelPickerOpen={false}
        onToggleModelPicker={vi.fn()}
        onSelectModel={vi.fn()}
        onChooseProject={chooseProject}
        onRefreshRuntime={refreshRuntime}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Выбрать уровень рассуждения: xhigh" }));
    await user.click(screen.getByRole("option", { name: /Высоко/ }));
    expect(screen.getByRole("button", { name: "Выбрать уровень рассуждения: high" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Выбрать проект. Текущий: ma-hi-ko" }));
    await user.click(screen.getByRole("button", { name: "Сделать контекст компактным" }));
    await user.click(screen.getByRole("button", { name: "Обновить состояние OMP" }));
    await user.click(screen.getByRole("button", { name: "Отправить сообщение" }));

    expect(chooseProject).toHaveBeenCalledOnce();
    expect(refreshRuntime).toHaveBeenCalledOnce();
    expect(submit).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Показать полный контекст" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Показать полный контекст" })).toHaveTextContent("1,9% · кратко");
  });

  it("перемещается по model/thinking listbox с клавиатуры и возвращает фокус", async () => {
    const user = userEvent.setup();
    render(<ComposerHarness />);

    await user.click(screen.getByRole("button", { name: "Выбрать модель: GPT-5.6 Sol" }));
    const modelList = screen.getByRole("listbox", { name: "Выбор модели" });
    expect(modelList).toHaveFocus();
    await user.keyboard("{ArrowDown}{Enter}");
    const modelTrigger = screen.getByRole("button", { name: "Выбрать модель: GPT-5.6 Luna" });
    expect(modelTrigger).toBeVisible();
    expect(modelTrigger).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Выбрать уровень рассуждения: xhigh" }));
    const thinkingList = screen.getByRole("listbox", { name: "Уровень рассуждения" });
    expect(thinkingList).toHaveFocus();
    await user.keyboard("{ArrowUp}{Enter}");
    const thinkingTrigger = screen.getByRole("button", { name: "Выбрать уровень рассуждения: high" });
    expect(thinkingTrigger).toBeVisible();
    expect(thinkingTrigger).toHaveFocus();
  });

  it("выбирает slash-команду без race и блокирует ввод во время работы", async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn();
    const { rerender } = render(<ComposerHarness onCommand={onCommand} />);
    const input = screen.getByRole("textbox", { name: "Сообщение ma-hi-ko" });

    await user.type(input, "/");
    expect(screen.getByRole("listbox", { name: "Команды OMP" })).toBeVisible();
    await user.keyboard("{ArrowDown}{Enter}");
    expect(onCommand).toHaveBeenCalledWith("/settings");
    expect(input).toHaveFocus();

    rerender(<ComposerHarness onCommand={onCommand} working />);
    expect(screen.getByRole("textbox", { name: "Сообщение ma-hi-ko" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Отправить сообщение" })).toBeDisabled();
  });
});
