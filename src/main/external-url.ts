const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * OAuth authorization pages must use HTTPS. OMP's optional short launch URL
 * is the only HTTP exception and is accepted strictly on the local loopback.
 */
export function normalizeExternalUrl(input: string): string {
  const value = input.trim();
  if (!value || value.length > 16_384) throw new Error("Внешний адрес пуст или слишком длинный");
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Внешний адрес имеет неверный формат");
  }
  if (parsed.protocol === "https:") return parsed.toString();
  if (parsed.protocol === "http:" && LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) return parsed.toString();
  throw new Error("Разрешены только HTTPS-адреса и HTTP loopback для OMP launch URL");
}
