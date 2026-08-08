import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import type { ProjectFileEntry, ProjectFilePreview } from "../shared/contracts";

const MAX_ENTRIES = 320;
const MAX_DEPTH = 5;
const MAX_FILE_BYTES = 128 * 1024;
const skippedNames = new Set(["node_modules", ".git", "dist", "dist-electron", "coverage", ".cache"]);
const sensitiveName = /(?:^|\.)env(?:\.|$)|(?:^|\.)(?:pem|key|p12|pfx)$|credentials|secrets?/i;

export async function listProjectFiles(rootPath: string): Promise<ProjectFileEntry[]> {
  if (!rootPath) return [];
  const canonicalRoot = await realpath(rootPath);
  const entries: ProjectFileEntry[] = [];
  await walk(canonicalRoot, canonicalRoot, 0, entries);
  return entries;
}

export async function readProjectFile(rootPath: string, requestedPath: string): Promise<ProjectFilePreview> {
  if (!rootPath) throw new Error("Сначала выберите папку проекта");
  const canonicalRoot = await realpath(rootPath);
  const candidate = resolve(canonicalRoot, requestedPath);
  assertInsideRoot(canonicalRoot, candidate);
  const candidateInfo = await lstat(candidate);
  if (candidateInfo.isSymbolicLink()) throw new Error("Символические ссылки не читаются");
  const canonicalCandidate = await realpath(candidate);
  assertInsideRoot(canonicalRoot, canonicalCandidate);
  if (sensitiveName.test(basename(canonicalCandidate))) throw new Error("Чтение потенциально секретного файла запрещено");
  if (!candidateInfo.isFile()) throw new Error("Можно читать только обычные файлы проекта");
  const buffer = await readFile(canonicalCandidate);
  if (buffer.includes(0)) throw new Error("Бинарные файлы не отображаются");
  const truncated = buffer.byteLength > MAX_FILE_BYTES;
  return {
    path: normalizeRelative(relative(canonicalRoot, canonicalCandidate)),
    content: buffer.subarray(0, MAX_FILE_BYTES).toString("utf8"),
    truncated,
  };
}

async function walk(root: string, directory: string, depth: number, output: ProjectFileEntry[]): Promise<void> {
  if (depth > MAX_DEPTH || output.length >= MAX_ENTRIES) return;
  const dirents = await readdir(directory, { withFileTypes: true });
  dirents.sort((left, right) => Number(right.isDirectory()) - Number(left.isDirectory()) || left.name.localeCompare(right.name, "ru"));
  for (const dirent of dirents) {
    if (output.length >= MAX_ENTRIES || skippedNames.has(dirent.name) || sensitiveName.test(dirent.name) || dirent.isSymbolicLink()) continue;
    const absolute = resolve(directory, dirent.name);
    assertInsideRoot(root, absolute);
    const path = normalizeRelative(relative(root, absolute));
    if (dirent.isDirectory()) {
      output.push({ path, name: dirent.name, kind: "directory", depth });
      await walk(root, absolute, depth + 1, output);
    } else if (dirent.isFile()) {
      output.push({ path, name: dirent.name, kind: "file", depth });
    }
  }
}

function assertInsideRoot(root: string, candidate: string): void {
  const relation = relative(root, candidate);
  if (relation === "" || (!relation.startsWith("..") && !isAbsolute(relation))) return;
  throw new Error("Путь находится вне проекта");
}

function normalizeRelative(value: string): string {
  return value.split(sep).join("/");
}
