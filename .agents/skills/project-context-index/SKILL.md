---
name: project-context-index
description: Maintain and use the project-root info.md as a compact repository map. Use when orienting in this project, when asked to reduce file reading or context usage, or after adding, moving, or removing top-level folders, entry points, build commands, or major subsystems.
---

# Project Context Index

Treat `info.md` as navigation metadata, not as a replacement for source truth.

## Locate before reading

1. Read `info.md` first.
2. Use `rg`, `git grep`, or a symbol/AST outline to locate candidates.
3. Read only the decisive symbol or line range. Expand to the whole file only
   when initialization order, an end-to-end flow, or a referenced contract
   cannot be understood locally.
4. Do not re-read unchanged files; reuse prior results and command output.

## Keep the map useful

Update `info.md` only after structural changes. Record:

- top-level folders and their job;
- active stack and entry points;
- build, test, lint, and run commands that were actually verified;
- local skills and narrow activation conditions;
- important boundaries and current risks.

Keep it concise. Link to source files instead of copying APIs, schemas, logs,
or documentation into the map. Never claim that the index is current unless
its folder list and commands were checked in the same turn.

If the map disagrees with source or tooling, trust the source/tool output and
fix the map in the smallest edit.
