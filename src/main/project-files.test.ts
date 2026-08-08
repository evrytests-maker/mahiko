import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listProjectFiles, readProjectFile } from "./project-files";

describe("project file boundary", () => {
  it("lists ordinary files while excluding secrets, build folders and symlinks", async () => {
    const root = await mkdtemp(join(tmpdir(), "mahiko-files-"));
    await mkdir(join(root, "src"));
    await mkdir(join(root, "node_modules"));
    await writeFile(join(root, "src", "App.tsx"), "export const App = true;\n");
    await writeFile(join(root, ".env.local"), "TOKEN=secret\n");
    await writeFile(join(root, "node_modules", "ignored.js"), "ignored\n");
    await symlink(join(root, "src", "App.tsx"), join(root, "linked.tsx"));

    const entries = await listProjectFiles(root);
    expect(entries.map((entry) => entry.path)).toContain("src/App.tsx");
    expect(entries.map((entry) => entry.path)).not.toContain(".env.local");
    expect(entries.map((entry) => entry.path)).not.toContain("node_modules");
    expect(entries.map((entry) => entry.path)).not.toContain("linked.tsx");
  });

  it("rejects traversal, secrets, symlinks and binary data", async () => {
    const root = await mkdtemp(join(tmpdir(), "mahiko-read-"));
    const outside = await mkdtemp(join(tmpdir(), "mahiko-outside-"));
    await writeFile(join(root, "safe.txt"), "safe\n");
    await writeFile(join(root, ".env"), "TOKEN=secret\n");
    await writeFile(join(root, "binary.bin"), Buffer.from([1, 0, 2]));
    await writeFile(join(outside, "outside.txt"), "outside\n");
    await symlink(join(outside, "outside.txt"), join(root, "linked.txt"));

    await expect(readProjectFile(root, "../outside.txt")).rejects.toThrow("вне проекта");
    await expect(readProjectFile(root, ".env")).rejects.toThrow("секретного");
    await expect(readProjectFile(root, "linked.txt")).rejects.toThrow("Символические ссылки");
    await expect(readProjectFile(root, "binary.bin")).rejects.toThrow("Бинарные файлы");
    await expect(readProjectFile(root, "safe.txt")).resolves.toMatchObject({ content: "safe\n", truncated: false });
  });
});
