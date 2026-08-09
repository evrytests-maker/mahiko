import process from "node:process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { discoverRuntime, loadOmpLock } = require("../dist-electron/main/omp-runtime.js");

const root = fileURLToPath(new URL("..", import.meta.url));
const lock = await loadOmpLock(root);
const snapshot = await discoverRuntime(
  process.cwd(),
  lock,
  process.env.MAHIKO_OMP_PATH ?? null,
);
process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
if (!snapshot.compatible || !snapshot.rpc.ready || snapshot.rpc.protocolVersion !== lock.protocolVersion) process.exitCode = 1;
