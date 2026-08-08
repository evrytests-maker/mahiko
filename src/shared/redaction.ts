const SENSITIVE_KEY = /(authorization|proxy-authorization|api[-_]?key|token|secret|password|passwd|cookie|credential|private[-_]?key)/i;
const BEARER_VALUE = /\b(?:bearer|basic)\s+[a-z0-9._~+/=-]{8,}/i;
const TOKENISH_VALUE = /\b(?:sk|ghp|github_pat|xox[baprs]|ya29)[-_][a-z0-9_-]{12,}/i;

export const REDACTED = "[REDACTED]";

export function redactUnknown(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") {
    return BEARER_VALUE.test(value) || TOKENISH_VALUE.test(value) ? REDACTED : value;
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  if (seen.has(value)) {
    return "[CIRCULAR]";
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactUnknown(item, seen));
  }

  const clean: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    clean[key] = SENSITIVE_KEY.test(key) ? REDACTED : redactUnknown(entry, seen);
  }
  return clean;
}

export function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const redacted = redactUnknown(message);
  return typeof redacted === "string" ? redacted.slice(0, 500) : "Unexpected error";
}
