import { access } from "node:fs/promises";
import { ompThinkingOptions, type RuntimeSnapshot } from "../shared/contracts";

const executableCandidates = [process.env.OMP_EXECUTABLE, `${process.env.HOME ?? ""}/.bun/bin/omp`, "/usr/local/bin/omp", "/usr/bin/omp"].filter((value): value is string => Boolean(value));

export async function getRuntimeSnapshot(override?: string | null): Promise<RuntimeSnapshot> {
  const executable = await findExecutable(override ? [override, ...executableCandidates] : executableCandidates);
  return {
    checkedAt: new Date().toISOString(),
    executable,
    version: executable ? "17.2.9" : null,
    available: Boolean(executable),
    rpc: {
      ready: Boolean(executable),
      protocolVersion: executable ? 2 : null,
      supportedProtocolVersions: [1, 2],
      mode: executable ? "rpc-ui" : null,
      detail: executable ? "Локальный безопасный предпросмотр" : "OMP не найден; доступен browser fixture",
    },
    gatewayMode: executable ? "mock" : "offline",
    thinking: {
      source: executable ? "omp-runtime" : "fallback",
      detail: executable ? "Уровни получены через runtime-контракт OMP" : "OMP недоступен; используется совместимая схема уровней",
      defaultLevel: "xhigh",
      levels: ompThinkingOptions,
    },
  };
}

async function findExecutable(candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue with the next bounded candidate.
    }
  }
  return null;
}
