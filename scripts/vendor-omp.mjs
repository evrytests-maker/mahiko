import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { chmod, mkdir, readFile, rename, stat, unlink } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const manifestPath = join(root, "vendor", "omp", "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const request = process.argv[2] ?? "current";
const currentTarget = `${process.platform}-${process.arch}`;
const targets = request === "all" ? Object.keys(manifest.assets) : [request === "current" ? currentTarget : request];

for (const target of targets) {
  const asset = manifest.assets[target];
  if (!asset) throw new Error(`OMP ${manifest.version} does not define an asset for ${target}`);
  const destination = join(root, "vendor", "omp", target, asset.executableName);
  await mkdir(dirname(destination), { recursive: true });
  if (await matches(destination, asset.sha256)) {
    await makeExecutable(destination, target);
    console.log(`OMP ${manifest.version} ${target}: verified cached executable`);
    continue;
  }

  const temporary = `${destination}.download`;
  await unlink(temporary).catch(() => undefined);
  console.log(`OMP ${manifest.version} ${target}: downloading ${asset.sourceName}`);
  const response = await fetch(asset.url, { redirect: "follow", headers: { "user-agent": "mahiko-build" } });
  if (!response.ok || !response.body) throw new Error(`Download failed: HTTP ${response.status} ${response.statusText}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary, { mode: 0o755 }));
  if (!await matches(temporary, asset.sha256)) {
    await unlink(temporary).catch(() => undefined);
    throw new Error(`SHA-256 mismatch for ${asset.sourceName}`);
  }
  await makeExecutable(temporary, target);
  await rename(temporary, destination);
  console.log(`OMP ${manifest.version} ${target}: ready at ${destination}`);
}

async function matches(path, expected) {
  try {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    return hash.digest("hex") === expected;
  } catch {
    return false;
  }
}

async function makeExecutable(path, target) {
  await stat(path);
  if (target.startsWith("linux-")) await chmod(path, 0o755);
}
