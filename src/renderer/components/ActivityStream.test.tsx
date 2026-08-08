import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ActivityRun, AgentStreamEvent } from "../../shared/contracts";
import { applyAgentStreamEvent, cancelActivityRun, createPreparingRun } from "../activity";
import { ActivityStream } from "./ActivityStream";

function observedRun(status: "running" | "success" | "error" = "success"): ActivityRun {
  let run = createPreparingRun("ui-run", "Проверить интерфейс", 0, 1_000);
  for (let index = 0; index < 6; index += 1) {
    run = applyAgentStreamEvent(run, {
      type: "tool_start",
      runId: run.id,
      toolCallId: `tool-${index}`,
      toolName: index === 0 ? "bash" : `tool-${index}`,
    }, 1_100 + index * 100);
    run = applyAgentStreamEvent(run, {
      type: "tool_end",
      runId: run.id,
      toolCallId: `tool-${index}`,
      toolName: index === 0 ? "bash" : `tool-${index}`,
      summary: index === 0 ? "Команда завершена" : "Готово",
      isError: false,
    }, 1_150 + index * 100);
  }
  if (status === "running") return run;
  const terminal: AgentStreamEvent = status === "success"
    ? { type: "completed", runId: run.id, text: "Готово", observedEventTypes: ["tool_execution_end"] }
    : { type: "error", runId: run.id, message: "Проверка завершилась с кодом 1" };
  return applyAgentStreamEvent(run, terminal, 2_520);
}

describe("ActivityStream", () => {
  it("shows provider-visible thinking live without mixing it into the answer rail", () => {
    let run = createPreparingRun("thinking-ui", "Вычислить", 0, 1_000);
    run = applyAgentStreamEvent(run, { type: "thinking_start", runId: run.id, contentIndex: 1 }, 1_050);
    run = applyAgentStreamEvent(run, { type: "thinking_delta", runId: run.id, contentIndex: 1, delta: "Проверяю числа" }, 1_100);

    render(<ActivityStream run={run} onStop={vi.fn()} onRetry={vi.fn()} />);

    const thinking = screen.getByRole("region", { name: "Thinking модели" });
    expect(within(thinking).getByText("THINKING · ПЕРЕДАНО МОДЕЛЬЮ")).toBeVisible();
    expect(within(thinking).getByText("Проверяю числа")).toBeVisible();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("keeps a compact five-row rail and expands observed tool details", async () => {
    const user = userEvent.setup();
    render(<ActivityStream run={observedRun()} onStop={vi.fn()} onRetry={vi.fn()} />);

    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    await user.click(screen.getByRole("button", { name: /Ещё 3 шага/ }));
    expect(screen.getAllByRole("listitem")).toHaveLength(8);

    const toolToggle = screen.getByRole("button", { name: /bash: Команда завершена/ });
    expect(toolToggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toolToggle);
    const details = document.getElementById(toolToggle.getAttribute("aria-controls") ?? "");
    expect(details).not.toBeNull();
    expect(within(details as HTMLElement).getByText("Наблюдаемый OMP tool event")).toBeVisible();
  });

  it("shows an immediate stop control while a live run is active", async () => {
    const user = userEvent.setup();
    const onStop = vi.fn();
    render(<ActivityStream run={observedRun("running")} onStop={onStop} onRetry={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /Остановить/ }));
    expect(onStop).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: /Повторить/ })).not.toBeInTheDocument();
  });

  it("offers retry after a real error or cancellation", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const failed = observedRun("error");
    const cancelled = cancelActivityRun(observedRun("running"), 2_520);

    const { rerender } = render(<ActivityStream run={failed} onStop={vi.fn()} onRetry={onRetry} />);
    await user.click(screen.getByRole("button", { name: /Повторить/ }));
    expect(onRetry).toHaveBeenCalledWith(failed);

    rerender(<ActivityStream run={cancelled} onStop={vi.fn()} onRetry={onRetry} />);
    expect(screen.getAllByText("Запрос остановлен пользователем").length).toBeGreaterThan(0);
  });
});
