import { describe, expect, it } from "vitest";
import { applyAgentStreamEvent, cancelActivityRun, createFailedRun, createPreparingRun } from "./activity";

describe("live OMP activity state", () => {
  it("derives visible tool and completion state only from observed stream events", () => {
    let run = createPreparingRun("run-live", "read fixture", 0, 100);
    run = applyAgentStreamEvent(run, { runId: run.id, type: "tool_start", toolCallId: "t1", toolName: "read" }, 110);
    run = applyAgentStreamEvent(run, { runId: run.id, type: "tool_end", toolCallId: "t1", toolName: "read", isError: false, summary: "Инструмент завершён" }, 120);
    run = applyAgentStreamEvent(run, { runId: run.id, type: "completed", text: "ok", observedEventTypes: ["tool_execution_start", "tool_execution_end", "agent_end"] }, 130);

    expect(run.status).toBe("success");
    expect(run.events.find((event) => event.id.endsWith(":tool:t1"))).toMatchObject({ status: "success", summary: "read: Инструмент завершён" });
    expect(run.events.at(-1)).toMatchObject({ kind: "complete", status: "success" });
  });

  it("keeps provider-visible thinking blocks separate and finalizes each OMP content index", () => {
    let run = createPreparingRun("run-thinking", "calculate", 0, 100);
    run = applyAgentStreamEvent(run, { runId: run.id, type: "thinking_start", contentIndex: 2 }, 105);
    run = applyAgentStreamEvent(run, { runId: run.id, type: "thinking_delta", contentIndex: 2, delta: "Проверяю" }, 110);
    run = applyAgentStreamEvent(run, { runId: run.id, type: "thinking_delta", contentIndex: 2, delta: " числа" }, 115);
    run = applyAgentStreamEvent(run, { runId: run.id, type: "thinking_end", contentIndex: 2, content: "Проверяю числа." }, 120);
    run = applyAgentStreamEvent(run, { runId: run.id, type: "thinking_start", contentIndex: 5 }, 125);
    run = applyAgentStreamEvent(run, { runId: run.id, type: "thinking_delta", contentIndex: 5, delta: "Сверяю ответ" }, 130);

    expect(run.thinkingBlocks).toEqual([
      { contentIndex: 2, text: "Проверяю числа.", status: "complete" },
      { contentIndex: 5, text: "Сверяю ответ", status: "running" },
    ]);
    expect(run.events).toHaveLength(1);
  });

  it("keeps cancellation terminal and ignores a late completion", () => {
    const running = createPreparingRun("run-cancel", "slow prompt", 0, 100);
    const cancelled = cancelActivityRun(running, 150);
    const late = applyAgentStreamEvent(cancelled, { runId: running.id, type: "completed", text: "late", observedEventTypes: ["agent_end"] }, 200);

    expect(late).toBe(cancelled);
    expect(late.status).toBe("cancelled");
    expect(late.events.filter((event) => event.kind === "cancelled")).toHaveLength(1);
  });

  it("creates an explicit error terminal without fake recovery", () => {
    const failed = createFailedRun("run-error", "prompt", 1, "RPC disconnected", 10, 30);
    expect(failed).toMatchObject({ status: "error", safeSummary: "RPC disconnected", startedAt: 10, endedAt: 30 });
  });
});
