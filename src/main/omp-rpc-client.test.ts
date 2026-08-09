// @vitest-environment node

import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OmpRpcClient } from "./omp-rpc-client";

const clients: OmpRpcClient[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) client.dispose();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fakeOmp(): Promise<string> {
  const directory = await mkdtemp(join(process.cwd(), ".mahiko-rpc-"));
  temporaryDirectories.push(directory);
  const executable = join(directory, "omp");
  await writeFile(executable, `#!${process.execPath}
const fs = require("node:fs");
const emit = (frame) => fs.writeSync(1, JSON.stringify(frame) + "\\n");
const sleep = (milliseconds) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
const readLine = () => {
  const bytes = [];
  const byte = Buffer.alloc(1);
  while (fs.readSync(0, byte, 0, 1, null) === 1) {
    if (byte[0] === 10) return Buffer.from(bytes).toString("utf8");
    if (byte[0] !== 13) bytes.push(byte[0]);
  }
  return bytes.length ? Buffer.from(bytes).toString("utf8") : null;
};
let emitAgentEndAfterAbort = true;
let delayedAgentEndAfterAbort = false;
let lastAssistantText = "old answer";
const mode = process.argv[process.argv.indexOf("--mode") + 1];
emit({ type: "ready", protocolVersion: 1, supportedProtocolVersions: [1, 2], maxFrameBytes: 1048576, maxReassembledFrameBytes: 67108864, mode });
for (let line = readLine(); line !== null; line = readLine()) {
  const frame = JSON.parse(line);
  if (frame.type === "negotiate_protocol") {
    emit({ id: frame.id, type: "response", command: frame.type, success: true, data: { protocolVersion: 2 } });
  } else if (frame.type === "prompt") {
    emitAgentEndAfterAbort = frame.message !== "cancel without terminal event";
    delayedAgentEndAfterAbort = frame.message === "cancel with delayed terminal event";
    emit({ id: frame.id, type: "response", command: frame.type, success: true });
    emit({ type: "agent_start" });
    if (frame.message === "after delayed cancellation") {
      emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "fresh answer" }, message: {} });
      sleep(75);
      lastAssistantText = "fresh answer";
      emit({ type: "agent_end", isTerminal: true, messages: [] });
    } else {
      emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "pong" }, message: {} });
      emit({ type: "tool_execution_start", toolCallId: "tool-1", toolName: "read", args: {} });
    }
  } else if (frame.type === "abort") {
    emit({ id: frame.id, type: "response", command: frame.type, success: true });
    emit({ type: "message_update", assistantMessageEvent: { type: "error", reason: "aborted", error: {} }, message: {} });
    if (delayedAgentEndAfterAbort) {
      sleep(25);
      emit({ type: "agent_end", isTerminal: true, messages: [] });
    }
    else if (emitAgentEndAfterAbort) emit({ type: "agent_end", isTerminal: true, messages: [] });
  } else if (frame.type === "get_last_assistant_text") {
    emit({ id: frame.id, type: "response", command: frame.type, success: true, data: { text: lastAssistantText } });
  }
}
`, { mode: 0o755 });
  await chmod(executable, 0o755);
  return executable;
}

async function fakeDelayedOmp(delayMs: number, negotiationDelayMs = 0, marker?: string, supportedVersions = [1, 2]): Promise<string> {
  const directory = await mkdtemp(join(process.cwd(), ".mahiko-rpc-delayed-"));
  temporaryDirectories.push(directory);
  const executable = join(directory, "omp");
  await writeFile(executable, `#!${process.execPath}
const fs = require("node:fs");
const emit = (frame) => fs.writeSync(1, JSON.stringify(frame) + "\\n");
const readLine = () => {
  const bytes = [];
  const byte = Buffer.alloc(1);
  while (fs.readSync(0, byte, 0, 1, null) === 1) {
    if (byte[0] === 10) return Buffer.from(bytes).toString("utf8");
    if (byte[0] !== 13) bytes.push(byte[0]);
  }
  return null;
};
const mode = process.argv[process.argv.indexOf("--mode") + 1];
${marker ? `fs.appendFileSync(${JSON.stringify(marker)}, mode + "\\n");` : ""}
setTimeout(() => {
  emit({ type: "ready", protocolVersion: 1, supportedProtocolVersions: ${JSON.stringify(supportedVersions)}, mode });
  const frame = JSON.parse(readLine());
  setTimeout(() => emit({ id: frame.id, type: "response", command: frame.type, success: true, data: { protocolVersion: 2 } }), ${negotiationDelayMs});
  setInterval(() => {}, 1000);
}, ${delayMs});
`, { mode: 0o755 });
  await chmod(executable, 0o755);
  return executable;
}

async function fakeRuntimeFailureOmp(marker: string): Promise<string> {
  const directory = await mkdtemp(join(process.cwd(), ".mahiko-rpc-runtime-error-"));
  temporaryDirectories.push(directory);
  const executable = join(directory, "omp");
  await writeFile(executable, `#!${process.execPath}
const fs = require("node:fs");
const mode = process.argv[process.argv.indexOf("--mode") + 1];
fs.appendFileSync(${JSON.stringify(marker)}, mode + "\\n");
fs.writeSync(2, "EACCES: cannot create native cache\\n");
process.exit(1);
`, { mode: 0o755 });
  await chmod(executable, 0o755);
  return executable;
}

describe("OmpRpcClient live process contract", () => {
  it("waits for delayed rpc-ui readiness and negotiates v2 without switching modes", async () => {
    const executable = await fakeDelayedOmp(75);
    const client = new OmpRpcClient(executable, process.cwd(), process.env, ["rpc-ui", "rpc"], 250);
    clients.push(client);

    await client.start();
    expect(client.mode).toBe("rpc-ui");
    expect(client.protocolVersion).toBe(2);
  });

  it("honors a configured startup timeout without waiting for the production cold-start budget", async () => {
    const executable = await fakeDelayedOmp(100);
    const client = new OmpRpcClient(executable, process.cwd(), process.env, ["rpc-ui"], 25);
    clients.push(client);

    await expect(client.start()).rejects.toThrow("25 ms");
  });

  it("does not fall back to rpc after rpc-ui is ready but lacks protocol v2", async () => {
    const directory = await mkdtemp(join(process.cwd(), ".mahiko-rpc-modes-"));
    temporaryDirectories.push(directory);
    const marker = join(directory, "modes.txt");
    const executable = await fakeDelayedOmp(0, 0, marker, [1]);
    const client = new OmpRpcClient(executable, process.cwd(), process.env, ["rpc-ui", "rpc"], 250);
    clients.push(client);

    await expect(client.start()).rejects.toThrow("не поддерживает protocol v2");
    expect(await readFile(marker, "utf8")).toBe("rpc-ui\n");
  });

  it("surfaces a pre-ready runtime/cache error without falling back to rpc", async () => {
    const directory = await mkdtemp(join(process.cwd(), ".mahiko-rpc-runtime-modes-"));
    temporaryDirectories.push(directory);
    const marker = join(directory, "modes.txt");
    const executable = await fakeRuntimeFailureOmp(marker);
    const client = new OmpRpcClient(executable, process.cwd(), process.env, ["rpc-ui", "rpc"], 250);
    clients.push(client);

    await expect(client.start()).rejects.toThrow("cannot create native cache");
    expect(await readFile(marker, "utf8")).toBe("rpc-ui\n");
  });

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
