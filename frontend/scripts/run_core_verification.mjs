#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { createRequire } from "node:module";
import ts from "/usr/local/slides_js/node_modules/typescript/lib/typescript.js";

const root = new URL("../", import.meta.url);
const rootPath = decodeURIComponent(root.pathname);
const reportDir = join(rootPath, "artifacts/verification/core");
const sourceFiles = [
  "src/shared/contracts.ts",
  "src/shared/preview-fixture.ts",
  "src/shared/redaction.ts",
  "src/renderer/activity.ts",
  "src/main/settings-store.ts",
  "src/main/project-files.ts",
];

const results = [];
async function check(name, operation) {
  try {
    await operation();
    results.push({ name, status: "pass" });
  } catch (error) {
    results.push({ name, status: "fail", detail: error instanceof Error ? error.stack : String(error) });
  }
}

const buildRoot = await mkdtemp(join(tmpdir(), "ma-hi-ko-core-"));
let failure = null;
try {
  for (const source of sourceFiles) {
    const sourcePath = join(rootPath, source);
    const outputPath = join(buildRoot, source.replace(/\.ts$/, ".js"));
    const text = await readFile(sourcePath, "utf8");
    const output = ts.transpileModule(text, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
        strict: true,
      },
      fileName: sourcePath,
      reportDiagnostics: true,
    });
    const diagnostics = output.diagnostics ?? [];
    assert.equal(diagnostics.length, 0, diagnostics.map((item) => ts.flattenDiagnosticMessageText(item.messageText, "\n")).join("\n"));
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, output.outputText, "utf8");
  }

  const require = createRequire(import.meta.url);
  const fixture = require(join(buildRoot, "src/shared/preview-fixture.js"));
  const activity = require(join(buildRoot, "src/renderer/activity.js"));
  const redaction = require(join(buildRoot, "src/shared/redaction.js"));
  const settings = require(join(buildRoot, "src/main/settings-store.js"));
  const project = require(join(buildRoot, "src/main/project-files.js"));

  await check("preview fixture is deterministic and has seven stable steps", () => {
    const first = fixture.createPreviewReply("Проверить интерфейс", { runId: "stable", attempt: 0 });
    const second = fixture.createPreviewReply("Проверить интерфейс", { runId: "stable", attempt: 0 });
    assert.deepEqual(first, second);
    assert.equal(first.activity.length, 7);
    assert.deepEqual(first.activity.map((step) => step.id), Array.from({ length: 7 }, (_, index) => `stable:step-${index + 1}`));
  });

  await check("preview payload exposes safe summaries only", () => {
    const reply = fixture.createPreviewReply("Проверить интерфейс", { runId: "safe" });
    const payload = JSON.stringify(reply).toLowerCase();
    assert.equal(payload.includes("chain-of-thought"), false);
    assert.equal(payload.includes("internalreasoning"), false);
    assert.equal(payload.includes("private_reasoning"), false);
    assert.equal(reply.activity.every((step) => step.summary.length < 90), true);
  });

  await check("first error attempt fails and retry succeeds", () => {
    const first = fixture.createPreviewReply("error demo", { runId: "retry", attempt: 0 });
    const retry = fixture.createPreviewReply("error demo", { runId: "retry", attempt: 1 });
    assert.equal(first.activity.find((step) => step.kind === "verify").exitCode, 1);
    assert.equal(retry.activity.find((step) => step.kind === "verify").exitCode, 0);
  });

  await check("activity transitions pending to running to success", async () => {
    let clock = 100;
    const updates = [];
    const reply = fixture.createPreviewReply("Проверить интерфейс", { runId: "success" });
    const initial = activity.createActivityRun(reply, "Проверить интерфейс", 0, clock);
    const final = await activity.executeActivityRun(initial, new AbortController().signal, (run) => updates.push(run.status), {
      now: () => clock,
      wait: async (ms) => { clock += ms; },
    });
    assert.equal(final.status, "success");
    assert.equal(final.events.every((event) => event.status === "success"), true);
    assert.equal(updates.at(0), "running");
    assert.equal(updates.at(-1), "success");
  });

  await check("activity stops at a failed verification and cancels remaining work", async () => {
    let clock = 500;
    const reply = fixture.createPreviewReply("Покажи error state", { runId: "error" });
    const initial = activity.createActivityRun(reply, "Покажи error state", 0, clock);
    const final = await activity.executeActivityRun(initial, new AbortController().signal, () => undefined, {
      now: () => clock,
      wait: async (ms) => { clock += ms; },
    });
    assert.equal(final.status, "error");
    assert.equal(final.events.find((event) => event.kind === "verify").status, "error");
    assert.equal(final.events.find((event) => event.kind === "complete").status, "cancelled");
    assert.equal(final.events.at(-1).kind, "error");
  });

  await check("AbortController cancels the active wait and publishes no late updates", async () => {
    let clock = 1_000;
    const controller = new AbortController();
    const updates = [];
    const reply = fixture.createPreviewReply("Отменить", { runId: "cancel" });
    const initial = activity.createActivityRun(reply, "Отменить", 0, clock);
    const running = activity.executeActivityRun(initial, controller.signal, (run) => updates.push(run.status), {
      now: () => clock,
      wait: (_ms, signal) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      }, { once: true })),
    });
    await Promise.resolve();
    clock = 1_250;
    controller.abort();
    const final = await running;
    const count = updates.length;
    await Promise.resolve();
    assert.equal(final.status, "cancelled");
    assert.equal(final.events.filter((event) => event.kind === "cancelled").length, 1);
    assert.equal(updates.length, count);
    assert.equal(updates.at(-1), "cancelled");
  });

  await check("settings normalization clamps layout and rejects invalid theme", () => {
    const normalized = settings.normalizeSettings({ theme: "neon", navWidth: -10, inspectorWidth: 9000, recentProjects: ["/a", 7, "/a"] });
    assert.equal(normalized.theme, "dark");
    assert.equal(normalized.navWidth, 168);
    assert.equal(normalized.inspectorWidth, 480);
    assert.deepEqual(normalized.recentProjects, ["/a"]);
  });

  await check("recursive redaction removes secret keys and bearer values", () => {
    const clean = redaction.redactUnknown({ headers: { Authorization: "Bearer private-value-123456789" }, nested: [{ api_key: "private" }] });
    assert.deepEqual(clean, { headers: { Authorization: redaction.REDACTED }, nested: [{ api_key: redaction.REDACTED }] });
  });

  await check("project boundary lists safe files and excludes secrets, builds and symlinks", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "ma-hi-ko-project-"));
    await mkdir(join(projectRoot, "src"));
    await mkdir(join(projectRoot, "node_modules"));
    await writeFile(join(projectRoot, "src", "App.tsx"), "export const App = true;\n");
    await writeFile(join(projectRoot, ".env.local"), "TOKEN=secret\n");
    await writeFile(join(projectRoot, "node_modules", "ignored.js"), "ignored\n");
    await symlink(join(projectRoot, "src", "App.tsx"), join(projectRoot, "linked.tsx"));
    const entries = await project.listProjectFiles(projectRoot);
    const paths = entries.map((entry) => entry.path);
    assert.equal(paths.includes("src/App.tsx"), true);
    assert.equal(paths.includes(".env.local"), false);
    assert.equal(paths.includes("node_modules"), false);
    assert.equal(paths.includes("linked.tsx"), false);
    await rm(projectRoot, { recursive: true, force: true });
  });

  await check("project boundary rejects traversal, secrets, symlinks and binary files", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "ma-hi-ko-read-"));
    const outside = await mkdtemp(join(tmpdir(), "ma-hi-ko-outside-"));
    await writeFile(join(projectRoot, "safe.txt"), "safe\n");
    await writeFile(join(projectRoot, ".env"), "TOKEN=secret\n");
    await writeFile(join(projectRoot, "binary.bin"), Buffer.from([1, 0, 2]));
    await writeFile(join(outside, "outside.txt"), "outside\n");
    await symlink(join(outside, "outside.txt"), join(projectRoot, "linked.txt"));
    await assert.rejects(project.readProjectFile(projectRoot, "../outside.txt"), /вне проекта/);
    await assert.rejects(project.readProjectFile(projectRoot, ".env"), /секретного/);
    await assert.rejects(project.readProjectFile(projectRoot, "linked.txt"), /Символические ссылки/);
    await assert.rejects(project.readProjectFile(projectRoot, "binary.bin"), /Бинарные файлы/);
    assert.equal((await project.readProjectFile(projectRoot, "safe.txt")).content, "safe\n");
    await rm(projectRoot, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });
} catch (error) {
  failure = error instanceof Error ? error.stack : String(error);
} finally {
  await rm(buildRoot, { recursive: true, force: true });
}

await mkdir(reportDir, { recursive: true });
const report = {
  generatedAt: new Date().toISOString(),
  sourceFiles: sourceFiles.map((path) => relative(rootPath, join(rootPath, path))),
  summary: {
    passed: results.filter((item) => item.status === "pass").length,
    failed: results.filter((item) => item.status === "fail").length + (failure ? 1 : 0),
  },
  results,
  failure,
};
await writeFile(join(reportDir, "core-verification.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
await writeFile(join(reportDir, "core-verification.txt"), [
  `Core verification: ${report.summary.passed} passed, ${report.summary.failed} failed`,
  ...results.map((item) => `${item.status === "pass" ? "PASS" : "FAIL"} ${item.name}${item.detail ? `\n${item.detail}` : ""}`),
  failure ? `FAIL runner\n${failure}` : "",
].filter(Boolean).join("\n"), "utf8");
console.log(JSON.stringify(report.summary));
if (report.summary.failed) process.exitCode = 1;
