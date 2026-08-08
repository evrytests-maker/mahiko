import type { ActivityEvent, ActivityRun, ActivityStatus, AgentStreamEvent } from "../shared/contracts";

let localRunSequence = 0;

export function nextActivityRunId(): string {
  localRunSequence += 1;
  return `activity-${Date.now()}-${localRunSequence}`;
}

export function createPreparingRun(id: string, prompt: string, attempt: number, now = Date.now()): ActivityRun {
  return {
    id,
    prompt,
    attempt,
    status: "running",
    safeSummary: "OMP выполняет запрос",
    startedAt: now,
    thinkingBlocks: [],
    events: [{
      id: `${id}:rpc`,
      kind: "command",
      summary: "OMP RPC выполняет agent turn",
      detail: "Отображаются только наблюдаемые события OMP.",
      durationMs: 0,
      status: "running",
      startedAt: now,
    }],
  };
}

export function createFailedRun(id: string, prompt: string, attempt: number, message: string, startedAt = Date.now(), endedAt = Date.now()): ActivityRun {
  return {
    id,
    prompt,
    attempt,
    status: "error",
    safeSummary: message,
    startedAt,
    endedAt,
    thinkingBlocks: [],
    events: [{
      id: `${id}:error:${attempt}`,
      kind: "error",
      summary: message,
      durationMs: Math.max(0, endedAt - startedAt),
      status: "error",
      startedAt,
      endedAt,
      errorMessage: message,
      recoveryHint: "Проверьте состояние OMP и повторите запрос.",
    }],
  };
}

export function applyAgentStreamEvent(run: ActivityRun, event: AgentStreamEvent, now = Date.now()): ActivityRun {
  if (event.runId !== run.id || isTerminal(run.status)) return run;
  switch (event.type) {
    case "started":
    case "text_delta":
      return run;
    case "thinking_start":
      return updateThinkingBlock(run, event.contentIndex, "", "running", false);
    case "thinking_delta":
      return updateThinkingBlock(run, event.contentIndex, event.delta, "running", true);
    case "thinking_end":
      return updateThinkingBlock(run, event.contentIndex, event.content, "complete", false);
    case "tool_start":
      return upsertEvent(run, {
        id: `${run.id}:tool:${event.toolCallId}`,
        kind: "command",
        summary: `${event.toolName} выполняется`,
        detail: "Наблюдаемый OMP tool event",
        durationMs: 0,
        status: "running",
        startedAt: now,
      });
    case "tool_update":
      return patchEvent(run, `${run.id}:tool:${event.toolCallId}`, { summary: `${event.toolName}: ${event.summary}` });
    case "tool_end":
      return patchEvent(run, `${run.id}:tool:${event.toolCallId}`, {
        summary: `${event.toolName}: ${event.summary}`,
        status: event.isError ? "error" : "success",
        endedAt: now,
      });
    case "notice":
      return upsertEvent(run, {
        id: `${run.id}:notice:${run.events.length}`,
        kind: event.level === "error" ? "error" : "verify",
        summary: event.message,
        durationMs: 0,
        status: event.level === "error" ? "error" : "success",
        startedAt: now,
        endedAt: now,
      });
    case "completed": {
      const completed: ActivityEvent = {
        id: `${run.id}:complete`,
        kind: "complete",
        summary: "OMP завершил запрос",
        detail: event.observedEventTypes.length ? `RPC events: ${event.observedEventTypes.join(", ")}` : "OMP вернул финальный текст",
        durationMs: Math.max(0, now - run.startedAt),
        status: "success",
        startedAt: run.startedAt,
        endedAt: now,
      };
      return {
        ...run,
        status: "success",
        safeSummary: completed.summary,
        endedAt: now,
        events: [...run.events.map((item) => item.status === "running" ? { ...item, status: "success" as const, endedAt: now } : item), completed],
      };
    }
    case "cancelled":
      return cancelActivityRun(run, now);
    case "error": {
      const failed = createFailedRun(run.id, run.prompt, run.attempt, event.message, run.startedAt, now);
      return {
        ...failed,
        thinkingBlocks: run.thinkingBlocks,
        events: [
          ...run.events.map((item) => item.status === "running" ? { ...item, status: "cancelled" as const, endedAt: now } : item),
          ...failed.events,
        ],
      };
    }
  }
}

function updateThinkingBlock(
  run: ActivityRun,
  contentIndex: number,
  text: string,
  status: "running" | "complete",
  append: boolean,
): ActivityRun {
  const existing = run.thinkingBlocks.find((block) => block.contentIndex === contentIndex);
  const nextBlock = {
    contentIndex,
    text: append ? `${existing?.text ?? ""}${text}` : text,
    status,
  };
  return {
    ...run,
    thinkingBlocks: existing
      ? run.thinkingBlocks.map((block) => block.contentIndex === contentIndex ? nextBlock : block)
      : [...run.thinkingBlocks, nextBlock],
  };
}

export function cancelActivityRun(run: ActivityRun, now = Date.now()): ActivityRun {
  if (isTerminal(run.status)) return run;
  const terminal: ActivityEvent = {
    id: `${run.id}:cancelled:${run.attempt}`,
    kind: "cancelled",
    summary: "Запрос остановлен пользователем",
    detail: "OMP получил abort; поздний success не будет показан.",
    durationMs: Math.max(0, now - run.startedAt),
    status: "cancelled",
    startedAt: run.startedAt,
    endedAt: now,
  };
  return {
    ...run,
    status: "cancelled",
    safeSummary: terminal.summary,
    endedAt: now,
    events: [
      ...run.events.map((item) => item.status === "running" || item.status === "pending" ? { ...item, status: "cancelled" as const, endedAt: now } : item),
      ...(run.events.some((item) => item.kind === "cancelled") ? [] : [terminal]),
    ],
  };
}

export function isTerminal(status: ActivityStatus): boolean {
  return status === "success" || status === "error" || status === "cancelled";
}

function upsertEvent(run: ActivityRun, event: ActivityEvent): ActivityRun {
  const found = run.events.some((item) => item.id === event.id);
  return {
    ...run,
    safeSummary: event.summary,
    events: found ? run.events.map((item) => item.id === event.id ? event : item) : [...run.events, event],
  };
}

function patchEvent(run: ActivityRun, id: string, patch: Partial<ActivityEvent>): ActivityRun {
  const current = run.events.find((item) => item.id === id);
  if (!current) return run;
  const next = { ...current, ...patch };
  return { ...run, safeSummary: next.summary, events: run.events.map((item) => item.id === id ? next : item) };
}
