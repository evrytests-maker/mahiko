import { describe, expect, it } from "vitest";
import { normalizeSettings } from "../main/settings-store";
import { redactUnknown, REDACTED } from "./redaction";

describe("trust boundaries", () => {
  it("recursively removes secret-bearing RPC fields and values", () => {
    const clean = redactUnknown({
      model: { headers: { Authorization: "Bearer test-value" } },
      nested: [{ api_key: "private" }],
      message: "Basic dXNlcjpwYXNzd29yZA==",
    });

    expect(clean).toEqual({
      model: { headers: { Authorization: REDACTED } },
      nested: [{ api_key: REDACTED }],
      message: REDACTED,
    });
  });

  it("clamps persisted layout and drops invalid values", () => {
    const settings = normalizeSettings({ theme: "neon", navWidth: -40, inspectorWidth: 9000, recentProjects: ["/a", 4] });
    expect(settings.theme).toBe("omp");
    expect(settings.navWidth).toBe(168);
    expect(settings.inspectorWidth).toBe(720);
    expect(settings.recentProjects).toEqual(["/a"]);
  });
});
