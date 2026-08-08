// @vitest-environment node

import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OmpRpcClient } from "./omp-rpc-client";

const clients: OmpRpcClient[] = [];

afterEach(() => {
  for (const client of clients.splice(0)) client.dispose();
});

async function fakeOmp(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "mahiko-rpc-"));
  const executable = join(directory, "omp");
  await writeFile(executable, `#!${process.execPath}
const readline = require("node:readline");
setInterval(() => {}, 1000);
let emitAgentEndAfterAbort = true;
let delayedAgentEndAfterAbort = false;
let lastAssistantText = "old answer";
const mode = process.argv[process.argv.indexOf("--mode") + 1];
console.log(JSON.stringify({ type: "ready", protocolVersion: 1, supportedProtocolVersions: [1, 2], maxFrameBytes: 1048576, maxReassembledFrameBytes: 67108864, mode }));
const input = readline.createInterface({ input: process.stdin });
input.on("line", (line) => {
  const frame = JSON.parse(line);
  if (frame.type === "negotiate_protocol") {
    process.stdout.write(JSON.stringify({ id: frame.id, type: "response", command: frame.type, success: true, data: { protocolVersion: 2 } }) + "\\n");
  } else if (frame.type === "prompt") {
    emitAgentEndAfterAbort = frame.message !== "cancel without terminal event";
    delayedAgentEndAfterAbort = frame.message === "cancel with delayed terminal event";
    process.stdout.write(JSON.stringify({ id: frame.id, type: "response", command: frame.type, success: true }) + "\\n");
    process.stdout.write(JSON.stringify({ type: "agent_start" }) + "\\n");
    if (frame.message === "after delayed cancellation") {
      process.stdout.write(JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "fresh answer" }, message: {} }) + "\\n");
      setTimeout(() => {
        lastAssistantText = "fresh answer";
        process.stdout.write(JSON.stringify({ type: "agent_end", isTerminal: true, messages: [] }) + "\\n");
      }, 75);
    } else {
      process.stdout.write(JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "pong" }, message: {} }) + "\\n");
      process.stdout.write(JSON.stringify({ type: "tool_execution_start", toolCallId: "tool-1", toolName: "read", args: {} }) + "\\n");
    }
  } else if (frame.type === "abort") {
    process.stdout.write(JSON.stringify({ id: frame.id, type: "response", command: frame.type, success: true }) + "\\n");
    process.stdout.write(JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "error", reason: "aborted", error: {} }, message: {} }) + "\\n");
    if (delayedAgentEndAfterAbort) setTimeout(() => process.stdout.write(JSON.stringify({ type: "agent_end", isTerminal: true, messages: [] }) + "\\n"), 25);
    else if (emitAgentEndAfterAbort) process.stdout.write(JSON.stringify({ type: "agent_end", isTerminal: true, messages: [] }) + "\\n");
  } else if (frame.type === "get_last_assistant_text") {
    process.stdout.write(JSON.stringify({ id: frame.id, type: "response", command: frame.type, success: true, data: { text: lastAssistantText } }) + "\\n");
  }
});
`, { mode: 0o755 });
  await chmod(executable, 0o755);
  return executable;
}

describe("OmpRpcClient live process contract", () => {
  it("negotiates protocol v2 in rpc-ui and aborts the active streamed prompt", async () => {
    const executable = await fakeOmp();
    const client = new OmpRpcClient(executable, process.cwd(), process.env, ["rpc-ui", "rpc"]);
    clients.push(client);

    await client.start();
    expect(client.mode).toBe("rpc-ui");
    expect(client.protocolVersion).toBe(2);

    const controller = new AbortController();
    const observed: string[] = [];
    const resultPromise = client.prompt("return pong", {
      signal: controller.signal,
      onEvent: (event) => {
        observed.push(String(event.type));
        if (event.type === "tool_execution_start") controller.abort();
      },
    });

    await expect(resultPromise).resolves.toMatchObject({ cancelled: true, text: "pong" });
    expect(observed).toEqual(expect.arrayContaining(["agent_start", "message_update", "tool_execution_start", "agent_end"]));
  });

  it("finishes cancellation when abort is acknowledged without a terminal agent_end", async () => {
    const executable = await fakeOmp();
    const client = new OmpRpcClient(executable, process.cwd(), process.env, ["rpc-ui"]);
    clients.push(client);
    await client.start();

    const controller = new AbortController();
    const resultPromise = client.prompt("cancel without terminal event", {
      signal: controller.signal,
      onEvent: (event) => {
        if (event.type === "tool_execution_start") controller.abort();
      },
    });

    await expect(Promise.race([
      resultPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("cancel remained pending")), 500)),
    ])).resolves.toMatchObject({ cancelled: true, text: "pong" });
  });

  it("does not let a delayed agent_end from an aborted turn finish the next prompt", async () => {
    const executable = await fakeOmp();
    const client = new OmpRpcClient(executable, process.cwd(), process.env, ["rpc-ui"]);
    clients.push(client);
    await client.start();

    const controller = new AbortController();
    const cancelled = client.prompt("cancel with delayed terminal event", {
      signal: controller.signal,
      onEvent: (event) => {
        if (event.type === "tool_execution_start") controller.abort();
      },
    });
    await expect(cancelled).resolves.toMatchObject({ cancelled: true });

    await expect(client.prompt("after delayed cancellation")).resolves.toMatchObject({
      cancelled: false,
      text: "fresh answer",
    });
  });
});
