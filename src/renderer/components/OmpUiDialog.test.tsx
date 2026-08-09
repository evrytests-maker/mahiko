import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { OmpUiDialog } from "./OmpUiDialog";

describe("OMP extension UI bridge", () => {
  it("returns the exact selected value to OMP", async () => {
    const user = userEvent.setup();
    const onRespond = vi.fn();
    render(<OmpUiDialog request={{ type: "select", id: "rpc-ui-1", title: "Choose", options: ["alpha", "beta"] }} onRespond={onRespond} />);

    await user.click(screen.getByRole("option", { name: "beta" }));
    expect(onRespond).toHaveBeenCalledWith({ id: "rpc-ui-1", value: "beta" });
  });

  it("maps Escape to one cancelled UI response without touching an active chat turn", async () => {
    const user = userEvent.setup();
    const onRespond = vi.fn();
    render(<OmpUiDialog request={{ type: "input", id: "rpc-ui-2", title: "Code", message: "Code", placeholder: "123" }} onRespond={onRespond} />);

    await user.keyboard("{Escape}");
    expect(onRespond).toHaveBeenCalledWith({ id: "rpc-ui-2", cancelled: true });
    expect(onRespond).toHaveBeenCalledTimes(1);
  });

  it("renders the OAuth code flow in Russian and keeps browser retry next to the field", async () => {
    const user = userEvent.setup();
    const onRespond = vi.fn();
    const onOpenExternal = vi.fn().mockResolvedValue(undefined);
    render(
      <OmpUiDialog
        request={{
          type: "input",
          id: "rpc-ui-auth",
          title: "Paste the authorization code (or full redirect URL):",
          message: "Paste the authorization code (or full redirect URL):",
        }}
        browserRequest={{
          type: "open_url",
          id: "rpc-ui-browser",
          url: "https://example.com/oauth/authorize",
          launchUrl: "http://127.0.0.1:4567/launch",
          instructions: "Complete sign in",
        }}
        onOpenExternal={onOpenExternal}
        onRespond={onRespond}
      />,
    );

    expect(screen.getByRole("heading", { name: "Вход через OMP" })).toBeVisible();
    expect(screen.getByLabelText("Код или URL перенаправления")).toBeVisible();
    expect(screen.queryByText("Paste the authorization code (or full redirect URL):")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Открыть браузер снова" }));
    expect(onOpenExternal).toHaveBeenCalledWith("https://example.com/oauth/authorize");

    await user.click(screen.getByRole("button", { name: "Отменить вход" }));
    expect(onRespond).toHaveBeenCalledWith({ id: "rpc-ui-auth", cancelled: true });
    expect(onRespond).toHaveBeenCalledTimes(1);
  });
});
