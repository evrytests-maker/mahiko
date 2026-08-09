import process from "node:process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { discoverRuntime, loadOmpLock } = require("../dist-electron/main/omp-runtime.js");
const { OmpRpcClient } = require("../dist-electron/main/omp-rpc-client.js");

const root = fileURLToPath(new URL("..", import.meta.url));
const fixture = fileURLToPath(new URL("../tests/fixtures/omp-live-read.txt", import.meta.url));
const lock = await loadOmpLock(root);
const override = process.env.MAHIKO_OMP_PATH ?? null;
const runtime = await discoverRuntime(root, lock, override);
if (!runtime.compatible || !runtime.rpc.ready || runtime.rpc.protocolVersion !== 2 || !runtime.executable || !runtime.rpc.mode) {
  throw new Error(`OMP runtime gate failed: ${runtime.rpc.detail}`);
}

const client = new OmpRpcClient(runtime.executable, root, process.env, [runtime.rpc.mode]);
const report = {
  runtime: { version: runtime.version, mode: runtime.rpc.mode, protocolVersion: runtime.rpc.protocolVersion },
  toolTurn: null,
  cancellation: null,
  restart: null,
};

try {
  await client.start();
  const toolTurn = await client.prompt(`Используй read tool, прочитай только файл ${fixture} и ответь ровно содержимым файла без пояснений.`);
  if (!toolTurn.text.includes("MAHIKO_TOOL_EVENT_OK")) throw new Error("Live OMP tool turn returned unexpected text");
  if (!toolTurn.eventTypes.includes("tool_execution_start") || !toolTurn.eventTypes.includes("tool_execution_end")) {
    throw new Error(`Live OMP turn did not expose tool lifecycle: ${toolTurn.eventTypes.join(", ")}`);
  }
  report.toolTurn = { ok: true, observedEventTypes: [...new Set(toolTurn.eventTypes)] };

  const controller = new AbortController();
  let abortSent = false;
  const fallbackAbort = setTimeout(() => controller.abort(), 1_500);
  const cancelled = await client.prompt("Ответь ровно: CANCEL_SHOULD_NOT_COMPLETE", {
    signal: controller.signal,
    onEvent: (frame) => {
      if (abortSent || (frame.type !== "agent_start" && frame.type !== "prompt_result" && frame.type !== "message_update")) return;
      abortSent = true;
      controller.abort();
    },
  });
  clearTimeout(fallbackAbort);
  if (!cancelled.cancelled) throw new Error("Live OMP abort was not observed as cancelled");
  report.cancellation = { ok: true, observedEventTypes: [...new Set(cancelled.eventTypes)] };

  const restart = await client.prompt("Ответь ровно: MAHIKO_RESTART_OK");
  if (restart.cancelled || !restart.text.includes("MAHIKO_RESTART_OK")) throw new Error("OMP did not recover after abort");
  report.restart = { ok: true, observedEventTypes: [...new Set(restart.eventTypes)] };
} finally {
  client.dispose();
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
