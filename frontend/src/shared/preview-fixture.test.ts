import { describe, expect, it } from "vitest";
import { createPreviewReply } from "./preview-fixture";

describe("preview activity adapter", () => {
  it("uses stable event ids and keeps private reasoning out of user-visible payloads", () => {
    const first = createPreviewReply("Проверить интерфейс", { runId: "stable", attempt: 0 });
    const second = createPreviewReply("Проверить интерфейс", { runId: "stable", attempt: 0 });

    expect(first).toEqual(second);
    expect(first.activity.map((step) => step.id)).toEqual([
      "stable:step-1", "stable:step-2", "stable:step-3", "stable:step-4", "stable:step-5", "stable:step-6", "stable:step-7",
    ]);
    expect(JSON.stringify(first).toLowerCase()).not.toContain("chain-of-thought");
    expect(first.activity.every((step) => step.summary.length < 90)).toBe(true);
  });

  it("fails only the first deterministic retry scenario", () => {
    const failed = createPreviewReply("error demo", { runId: "retry", attempt: 0 });
    const retried = createPreviewReply("error demo", { runId: "retry", attempt: 1 });

    expect(failed.activity.find((step) => step.kind === "verify")).toMatchObject({ outcome: "error", exitCode: 1 });
    expect(retried.activity.find((step) => step.kind === "verify")).toMatchObject({ outcome: "success", exitCode: 0 });
  });
});
