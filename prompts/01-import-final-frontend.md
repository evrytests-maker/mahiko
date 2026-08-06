# Task 1 — import the staged frontend

Read `AGENTS.md`, `info.md` and `project-map/info.md`. Use `frontend/` as the only visual and interaction source of truth. It is a preserved handoff: first inventory and compare it, then adapt its renderer into the root application without overwriting the handoff directory.

Requirements:

1. Preserve the secure root Electron main/preload boundary and the exact OMP contract.
2. Replace the root placeholder only with frontend code and assets that are actually present in `frontend/`.
3. Remove deterministic preview/mock activity from the integrated renderer; do not replace it with fake live behavior.
4. Do not restore beta-redesign, marketplace experiments, `work/`, `outputs/`, build artifacts, bundled dependencies or credentials.
5. Reconcile dependencies minimally, update tests and `info.md`, and record every intentional deviation from the staged handoff.
6. Stop after a clean visual import. Do not start live OMP prompt execution in this task.

