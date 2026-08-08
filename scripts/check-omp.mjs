import process from "node:process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { discoverRuntime, loadOmpLock } = require("../dist-electron/main/omp-runtime.js");

const root = fileURLToPath(new URL("..", import.meta.url));
const lock = await loadOmpLock(root);
const bundled = process.env.MAHIKO_OMP_BUNDLED_PATH
  ?? (["linux", "win32"].includes(process.platform) && process.arch === "x64"
    ? join(root, "vendor", "omp", `${process.platform}-${process.arch}`, process.platform === "win32" ? "omp.exe" : "omp")
    : null);
const snapshot = await discoverRuntime(
  process.cwd(),
  lock,
  process.env.MAHIKO_OMP_PATH ?? null,
  { bundledExecutable: bundled },
);
process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
if (!snapshot.compatible || !snapshot.rpc.ready || snapshot.rpc.protocolVersion !== lock.protocolVersion) process.exitCode = 1;
