import { afterEach, describe, expect, it, vi } from "vitest";
import { createPreviewReply } from "../shared/preview-fixture";
import {
  cancelActivityRun,
  createActivityRun,
  createFailedRun,
  executeActivityRun,
  waitForDuration,
} from "./activity";

function abortError(): Error {
  const error = new Error("aborted");
  error.name = "AbortError";
  return error;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("activity runner", () => {
  it("performs deterministic pending → running → success transitions", async () => {
    let clock = 100;
    const updates: string[] = [];
    const reply = createPreviewReply("Проверить интерфейс", { runId: "run-success" });
    const initial = createActivityRun(reply, "Проверить интерфейс", 0, clock);

    const final = await executeActivityRun(initial, new AbortController().signal, (run) => {
      updates.push(`${run.status}:${run.events.map((event) => event.status).join(",")}`);
    }, {
      now: () => clock,
      wait: async (ms) => { clock += ms; },
    });

    expect(final.status).toBe("success");
    expect(final.events).toHaveLength(7);
    expect(final.events.every((event) => event.status === "success")).toBe(true);
    expect(final.endedAt).toBe(1_620);
    expect(updates[0]).toMatch(/^running:pending/);
    expect(updates.some((entry) => entry.includes("running:running"))).toBe(true);
    expect(updates.at(-1)).toMatch(/^success:success/);
  });

  it("stops at an error, preserves the failed command and cancels remaining work", async () => {
    let clock = 500;
    let waits = 0;
    const reply = createPreviewReply("Покажи error state", { runId: "run-error" });
    const initial = createActivityRun(reply, "Покажи error state", 0, clock);

    const final = await executeActivityRun(initial, new AbortController().signal, () => undefined, {
      now: () => clock,
      wait: async (ms) => { waits += 1; clock += ms; },
    });

    expect(final.status).toBe("error");
    expect(waits).toBe(6);
    expect(final.events.find((event) => event.kind === "verify")).toMatchObject({ status: "error", exitCode: 1 });
    expect(final.events.find((event) => event.kind === "complete")?.status).toBe("cancelled");
    expect(final.events.at(-1)).toMatchObject({ kind: "error", status: "error" });
    expect(final.safeSummary).toBe("Проверка завершилась с кодом 1");
  });

  it("aborts the active wait, marks incomplete events cancelled and emits no late updates", async () => {
    let clock = 1_000;
    const controller = new AbortController();
    const updates: string[] = [];
    const reply = createPreviewReply("Отменить задачу", { runId: "run-cancel" });
    const initial = createActivityRun(reply, "Отменить задачу", 0, clock);
    const wait = vi.fn((_ms: number, signal: AbortSignal) => new Promise<void>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(abortError()), { once: true });
    }));

    const running = executeActivityRun(initial, controller.signal, (run) => {
      updates.push(run.status);
    }, { now: () => clock, wait });
    await Promise.resolve();
    clock = 1_250;
    controller.abort();
    const final = await running;
    const updateCount = updates.length;
    await Promise.resolve();

    expect(wait).toHaveBeenCalledOnce();
    expect(final.status).toBe("cancelled");
    expect(final.events.filter((event) => event.kind === "cancelled")).toHaveLength(1);
    expect(final.events.filter((event) => event.kind !== "cancelled").every((event) => event.status === "cancelled")).toBe(true);
    expect(updates).toHaveLength(updateCount);
    expect(updates.at(-1)).toBe("cancelled");
  });

  it("clears the real timer when AbortSignal fires", async () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    const controller = new AbortController();
    const pending = waitForDuration(5_000, controller.signal);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(clearSpy).toHaveBeenCalled();
  });

  it("creates deterministic terminal fallbacks and does not recancel terminal runs", () => {
    const failed = createFailedRun("fallback", "prompt", 2, "Нет связи", 10, 30);
    expect(failed).toMatchObject({ status: "error", startedAt: 10, endedAt: 30 });
    expect(cancelActivityRun(failed, 40)).toBe(failed);
  });
});
