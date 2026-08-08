import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { OmpUiDialog } from "./OmpUiDialog";

describe("OMP extension UI bridge", () => {
  it("returns the exact selected value to OMP", async () => {
    const user = userEvent.setup();
    const onRespond = vi.fn();
    render(<OmpUiDialog request={{ type: "select", id: "rpc-ui-1", title: "Choose", options: ["alpha", "beta"] }} onRespond={onRespond} onEscape={vi.fn()} />);

    await user.click(screen.getByRole("option", { name: "beta" }));
    expect(onRespond).toHaveBeenCalledWith({ id: "rpc-ui-1", value: "beta" });
  });

  it("maps Escape to a cancelled UI response and live-turn abort", async () => {
    const user = userEvent.setup();
    const onRespond = vi.fn();
    const onEscape = vi.fn();
    render(<OmpUiDialog request={{ type: "input", id: "rpc-ui-2", title: "Code", message: "Code", placeholder: "123" }} onRespond={onRespond} onEscape={onEscape} />);

    await user.keyboard("{Escape}");
    expect(onRespond).toHaveBeenCalledWith({ id: "rpc-ui-2", cancelled: true });
    expect(onEscape).toHaveBeenCalledOnce();
  });
});
