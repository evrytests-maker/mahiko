import { useState, type JSX } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CommandPalette, SettingsOverlay } from "./Overlays";

function SettingsHarness(): JSX.Element {
  const [open, setOpen] = useState(false);
  return <><button type="button" onClick={() => setOpen(true)}>Открыть настройки</button>{open ? <SettingsOverlay onClose={() => setOpen(false)} /> : null}</>;
}

function PaletteHarness({ onCommand }: { onCommand(command: string): void }): JSX.Element {
  const [open, setOpen] = useState(false);
  return <><button type="button" aria-label="Открыть команды" onClick={() => setOpen(true)}>Команды</button>{open ? <CommandPalette onClose={() => setOpen(false)} onCommand={onCommand} /> : null}</>;
}

describe("overlays", () => {
  it("фокусирует настройки, поддерживает стрелки и возвращает фокус после Escape", async () => {
    const user = userEvent.setup();
    render(<SettingsHarness />);
    const trigger = screen.getByRole("button", { name: "Открыть настройки" });
    await user.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Настройки OMP" });
    expect(dialog).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    const modelTab = screen.getByRole("tab", { name: "Модель" });
    expect(modelTab).toHaveAttribute("aria-selected", "true");
    await user.click(modelTab);
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Управление" })).toHaveAttribute("aria-selected", "true");

    await user.click(screen.getByRole("tab", { name: "Вид" }));
    const colorBlind = screen.getByRole("button", { name: /Режим для дальтонизма/ });
    expect(colorBlind).toHaveAttribute("aria-pressed", "false");
    await user.click(colorBlind);
    expect(colorBlind).toHaveAttribute("aria-pressed", "true");
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("button", { name: /Профиль строки/ })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Настройки OMP" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("фильтрует палитру, выполняет Enter и закрывается по Escape с восстановлением фокуса", async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn();
    render(<PaletteHarness onCommand={onCommand} />);
    const trigger = screen.getByRole("button", { name: "Открыть команды" });

    await user.click(trigger);
    const input = screen.getByRole("textbox", { name: "Фильтр команд" });
    await user.type(input, "mcp");
    await user.keyboard("{Enter}");
    expect(onCommand).toHaveBeenCalledWith("/mcp list");

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Палитра команд" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
