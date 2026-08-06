import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ActivityRun } from "../../shared/contracts";
import { createPreviewReply } from "../../shared/preview-fixture";
import { createActivityRun } from "../activity";
import { ActivityStream } from "./ActivityStream";

function completedRun(prompt = "Проверить интерфейс"): ActivityRun {
  const reply = createPreviewReply(prompt, { runId: "ui-run" });
  const startedAt = 1_000;
  return {
    ...createActivityRun(reply, prompt, 0, startedAt),
    status: "success",
    endedAt: 2_520,
    events: reply.activity.map((event, index) => ({
      ...event,
      status: "success" as const,
      startedAt: startedAt + index * 100,
      endedAt: startedAt + index * 100 + event.durationMs,
    })),
  };
}

describe("ActivityStream", () => {
  it("keeps a compact five-row rail and expands command details with capped output", async () => {
    const user = userEvent.setup();
    render(<ActivityStream run={completedRun()} onStop={vi.fn()} onRetry={vi.fn()} />);

    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    await user.click(screen.getByRole("button", { name: /Ещё 2 шага/ }));
    expect(screen.getAllByRole("listitem")).toHaveLength(7);

    const commandToggle = screen.getByRole("button", { name: /Запускаю локальную проверочную команду/ });
    expect(commandToggle).toHaveAttribute("aria-expanded", "false");
    await user.click(commandToggle);
    expect(commandToggle).toHaveAttribute("aria-expanded", "true");

    const details = document.getElementById(commandToggle.getAttribute("aria-controls") ?? "");
    expect(details).not.toBeNull();
    expect(within(details as HTMLElement).getByText("npm run typecheck", { exact: false })).toBeVisible();
    expect(within(details as HTMLElement).getByText("Код завершения")).toBeVisible();
    expect(within(details as HTMLElement).getByText(/последние 20 из 28 строк/)).toBeVisible();
    expect(details).toHaveTextContent("09  src/renderer/ActivityStream.tsx");
    expect(details).toHaveTextContent("28  src/renderer/App.tsx");
    expect(details).not.toHaveTextContent("01  src/renderer/App.tsx");
  });

  it("shows an immediate stop control while running and calls it once", async () => {
    const user = userEvent.setup();
    const onStop = vi.fn();
    const run = completedRun();
    run.status = "running";
    run.endedAt = undefined;
    run.events = run.events.map((event, index) => ({
      ...event,
      status: index === 2 ? "running" : index < 2 ? "success" : "pending",
      startedAt: index <= 2 ? event.startedAt : undefined,
      endedAt: index < 2 ? event.endedAt : undefined,
    }));

    render(<ActivityStream run={run} onStop={onStop} onRetry={vi.fn()} />);
    expect(screen.getByText("Формирую краткий план наблюдаемых действий")).toBeVisible();
    await user.click(screen.getByRole("button", { name: /Остановить/ }));
    expect(onStop).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: /Повторить/ })).not.toBeInTheDocument();
  });

  it("offers retry for terminal error/cancel states without making static rows look expandable", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const run = completedRun("error demo");
    run.status = "error";
    run.safeSummary = "Проверка завершилась с кодом 1";
    run.events = run.events.map((event) => event.kind === "verify"
      ? { ...event, status: "error", exitCode: 1, errorMessage: "Проверка завершилась с кодом 1" }
      : event);

    render(<ActivityStream run={run} onStop={vi.fn()} onRetry={onRetry} />);
    await user.click(screen.getByRole("button", { name: /Повторить/ }));
    expect(onRetry).toHaveBeenCalledWith(run);

    const staticSummary = screen.getByText("Собираю краткий итог без скрытого рассуждения");
    expect(staticSummary.closest("button")).toBeNull();
  });
});
