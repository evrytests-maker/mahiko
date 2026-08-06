import type { ActivityEvent, ActivityRun, ActivityStatus, PreviewReply } from "../shared/contracts";

export type ActivityWait = (ms: number, signal: AbortSignal) => Promise<void>;

interface ExecuteOptions {
  now?: () => number;
  wait?: ActivityWait;
}

let localRunSequence = 0;

export function nextActivityRunId(): string {
  localRunSequence += 1;
  return `activity-${localRunSequence}`;
}

export function createPreparingRun(id: string, prompt: string, attempt: number, now = Date.now()): ActivityRun {
  return {
    id,
    prompt,
    attempt,
    status: "running",
    safeSummary: "Подготавливаю безопасный план действий",
    startedAt: now,
    events: [{
      id: `${id}:prepare`,
      kind: "plan",
      summary: "Подготавливаю безопасный план действий",
      detail: "Формируется только перечень наблюдаемых операций — без скрытого рассуждения.",
      durationMs: 0,
      status: "running",
      startedAt: now,
    }],
  };
}

export function createActivityRun(reply: PreviewReply, prompt: string, attempt: number, startedAt = Date.now()): ActivityRun {
  return {
    id: reply.id,
    prompt,
    attempt,
    status: "pending",
    safeSummary: reply.summary,
    startedAt,
    events: reply.activity.map((step) => ({ ...step, status: "pending" })),
  };
}

export function createFailedRun(id: string, prompt: string, attempt: number, message: string, startedAt = Date.now(), endedAt = Date.now()): ActivityRun {
  return {
    id,
    prompt,
    attempt,
    status: "error",
    safeSummary: "Не удалось подготовить безопасный предпросмотр",
    startedAt,
    endedAt,
    events: [{
      id: `${id}:error`,
      kind: "error",
      summary: message,
      detail: "Повторите операцию после проверки подключения к локальному адаптеру.",
      durationMs: Math.max(0, endedAt - startedAt),
      status: "error",
      startedAt,
      endedAt,
      errorMessage: message,
      recoveryHint: "Проверьте состояние OMP и повторите запрос.",
    }],
  };
}

export function cancelActivityRun(run: ActivityRun, now = Date.now()): ActivityRun {
  if (isTerminal(run.status)) return run;
  const terminal: ActivityEvent = {
    id: `${run.id}:cancelled:${run.attempt}`,
    kind: "cancelled",
    summary: "Операция остановлена пользователем",
    detail: "Завершённые шаги сохранены. Незавершённые действия больше не выполняются.",
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
      ...run.events.map((event) => event.status === "success" || event.status === "error"
        ? event
        : { ...event, status: "cancelled" as const, endedAt: now }),
      ...(run.events.some((event) => event.kind === "cancelled") ? [] : [terminal]),
    ],
  };
}

export async function executeActivityRun(
  initialRun: ActivityRun,
  signal: AbortSignal,
  onUpdate: (run: ActivityRun) => void,
  options: ExecuteOptions = {},
): Promise<ActivityRun> {
  const now = options.now ?? Date.now;
  const wait = options.wait ?? waitForDuration;
  let run: ActivityRun = { ...initialRun, status: "running" };
  let settled = false;

  const publish = () => {
    if (!settled) onUpdate(run);
  };

  try {
    throwIfAborted(signal);
    publish();

    for (let index = 0; index < run.events.length; index += 1) {
      throwIfAborted(signal);
      const step = run.events[index];
      if (!step) continue;
      const startedAt = now();
      run = updateEvent(run, index, { status: "running", startedAt });
      run = { ...run, safeSummary: step.summary };
      publish();

      await wait(step.durationMs, signal);
      throwIfAborted(signal);
      const endedAt = now();

      if (step.outcome === "error") {
        const message = step.errorMessage ?? "Операция завершилась с ошибкой";
        run = updateEvent(run, index, { status: "error", endedAt });
        run = {
          ...run,
          status: "error",
          safeSummary: message,
          endedAt,
          events: [
            ...run.events.map((event, eventIndex) => eventIndex > index && event.status === "pending"
              ? { ...event, status: "cancelled" as const, endedAt }
              : event),
            {
              id: `${run.id}:error:${run.attempt}`,
              kind: "error",
              summary: message,
              detail: step.recoveryHint ?? "Откройте детали шага и повторите операцию после исправления.",
              durationMs: 0,
              status: "error",
              startedAt: endedAt,
              endedAt,
              errorMessage: message,
              recoveryHint: step.recoveryHint,
            },
          ],
        };
        publish();
        settled = true;
        return run;
      }

      run = updateEvent(run, index, { status: "success", endedAt });
      publish();
    }

    const endedAt = now();
    run = {
      ...run,
      status: "success",
      safeSummary: initialRun.safeSummary,
      endedAt,
    };
    publish();
    settled = true;
    return run;
  } catch (error) {
    if (isAbortError(error) || signal.aborted) {
      run = cancelActivityRun(run, now());
      publish();
      settled = true;
      return run;
    }

    const message = error instanceof Error ? error.message : "Неожиданная ошибка activity-runner";
    run = createFailedRun(run.id, run.prompt, run.attempt, message, run.startedAt, now());
    publish();
    settled = true;
    return run;
  }
}

export function waitForDuration(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(createAbortError());
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, Math.max(0, ms));
    const onAbort = () => {
      globalThis.clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(createAbortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function isTerminal(status: ActivityStatus): boolean {
  return status === "success" || status === "error" || status === "cancelled";
}

function updateEvent(run: ActivityRun, index: number, patch: Partial<ActivityEvent>): ActivityRun {
  return {
    ...run,
    events: run.events.map((event, eventIndex) => eventIndex === index ? { ...event, ...patch } : event),
  };
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw createAbortError();
}

function createAbortError(): Error {
  const error = new Error("Операция отменена");
  error.name = "AbortError";
  return error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
