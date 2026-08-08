# Mahiko repository map

Mahiko is a Linux-buildable Electron integration workspace. The supplied frontend has been staged but is intentionally not connected to the root shell yet. OMP remains an external executable locked to version 17.2.9.

## Top-level layout

- `frontend/` — exact unpacked frontend handoff from `ma-hi-ko-ui-visual-verified.zip`; immutable until an explicit merge task.
- `project-map/` — exact map shipped with that frontend; retained as source-of-truth documentation for the handoff itself.
- `src/main/` — root Electron lifecycle, OMP discovery/version gate/RPC readiness and IPC handlers.
- `src/preload/` — narrow `window.mohiko.runtime` bridge.
- `src/shared/` — renderer/main contracts.
- `src/renderer/` — framework-free runtime-status placeholder; not the supplied frontend.
- `prompts/00-start-merge.md` — start prompt with merge scope plus browser and live OMP test authorization.
- `prompts/01-*.md` through `03-*.md` — ordered import, live connection and verification tasks; documentation only until invoked.
- `skills/` — only Ponytail, project-context-index, systematic-debugging and verification-before-completion.
- `RULES.md`, `prefill.md`, `AGENTS.md` — root-level operating rules and merge handoff.
- `.codex/scratch/` — ignored temporary investigation data.
- `.github/workflows/` — clean Linux build and package verification.
- `omp.lock.json` — exact executable, RPC mode and protocol contract.

## Root entry points

- `src/main/main.ts` — secure BrowserWindow and app lifecycle.
- `src/main/ipc.ts` — cached runtime snapshot and refresh handlers.
- `src/main/omp-runtime.ts` — executable discovery, exact version check and bounded RPC probe.
- `src/preload/preload.ts` — isolated runtime API exposure.
- `src/renderer/main.ts` — observed-status-only placeholder.
- `scripts/check-omp.mjs` — real local OMP probe without an agent prompt.

## Commands

- `npm run dev` — Vite plus Electron development shell.
- `npm run typecheck` — renderer and main/preload TypeScript checks.
- `npm test` — runtime unit and fake-process tests.
- `npm run build` — renderer and Electron process output.
- `npm run check:omp` — probe the locally installed OMP without prompt execution.
- `npm run pack:linux` — unpacked x64 Linux application.
- `npm run dist:linux` — AppImage, deb, rpm and tar.gz.

## Runtime flow

`Electron main → locate external omp → omp --version → exact 17.2.9 gate → rpc-ui/v2 readiness → rpc fallback → cached RuntimeSnapshot → isolated preload → status renderer`

The current discovery flow sends no prompt or tool call. The future merge prompt separately authorizes bounded live OMP requests for integration verification; credentials and persistent OMP state never enter the repository.

## Merge boundary

The root and staged frontend currently have separate package graphs and entry points. The future merge must first inventory the staged UI, then adapt it into the root renderer deliberately. Do not resolve this by copying root runtime files over similarly named files inside `frontend/`.

Updated: 2026-08-08.
