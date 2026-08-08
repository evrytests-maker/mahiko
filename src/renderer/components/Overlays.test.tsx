import { useState, type JSX } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CommandPalette } from "./Overlays";

function PaletteHarness({ onCommand }: { onCommand(command: string): void }): JSX.Element {
  const [open, setOpen] = useState(false);
  return <><button type="button" aria-label="Открыть команды" onClick={() => setOpen(true)}>Команды</button>{open ? <CommandPalette onClose={() => setOpen(false)} onCommand={onCommand} /> : null}</>;
}

describe("CommandPalette", () => {
  it("фильтрует, выполняет Enter и закрывается Escape с восстановлением фокуса", async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn();
    render(<PaletteHarness onCommand={onCommand} />);
    const trigger = screen.getByRole("button", { name: "Открыть команды" });

    await user.click(trigger);
    const input = screen.getByRole("textbox", { name: "Фильтр команд" });
    await user.type(input, "tools");
    await user.keyboard("{Enter}");
    expect(onCommand).toHaveBeenCalledWith("/tools");

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Палитра команд" })).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
