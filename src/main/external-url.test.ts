import { describe, expect, it } from "vitest";
import { normalizeExternalUrl } from "./external-url";

describe("external OAuth URLs", () => {
  it("allows HTTPS authorization pages and loopback launch redirects", () => {
    expect(normalizeExternalUrl("https://example.com/oauth/authorize?state=one")).toBe("https://example.com/oauth/authorize?state=one");
    expect(normalizeExternalUrl("http://127.0.0.1:4567/launch")).toBe("http://127.0.0.1:4567/launch");
    expect(normalizeExternalUrl("http://localhost:4567/launch")).toBe("http://localhost:4567/launch");
    expect(normalizeExternalUrl("http://[::1]:4567/launch")).toBe("http://[::1]:4567/launch");
  });

  it("rejects non-loopback HTTP and non-web protocols", () => {
    expect(() => normalizeExternalUrl("http://example.com/oauth")).toThrow(/HTTPS|loopback/i);
    expect(() => normalizeExternalUrl("file:///tmp/token")).toThrow(/HTTPS|loopback/i);
    expect(() => normalizeExternalUrl("javascript:alert(1)")).toThrow(/HTTPS|loopback/i);
  });
});
