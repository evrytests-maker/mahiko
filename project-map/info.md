# Project map

`ma-hi-ko` is a Linux-first Electron shell whose visual language is based on the locally installed OMP 17.2.9 TUI. The activity implementation borrows only general progressive-disclosure and interruptibility patterns from terminal coding agents; no external branding or pixel layout is copied.

## Entry points

- `frontend/src/main/main.ts` — Electron `BrowserWindow`, isolated marketplace view and security policy.
- `frontend/src/main/ipc.ts` — validated IPC handlers, diagnostics, project bridge and skill dry-run boundary.
- `frontend/src/main/project-files.ts` — bounded source tree/read operations; rejects traversal, secrets, binaries, symlinks, build output and paths outside the project.
- `frontend/src/main/omp-runtime.ts` — OMP discovery, version parsing and bounded RPC readiness probe.
- `frontend/src/main/omp-gateway.ts` — disabled real-agent boundary plus deterministic preview gateway.
- `frontend/src/preload/preload.ts` — narrow typed renderer API exposed through `contextBridge`.
- `frontend/src/renderer/main.tsx` — React renderer bootstrap.
- `frontend/src/renderer/App.tsx` — Russian desktop shell, transcript entries, slash routing, sidebar, Inspector, focus restoration, near-bottom autoscroll and active-run cancellation.
- `frontend/src/renderer/activity.ts` — presentation-independent ActivityRun state machine, abort-aware waits and terminal transitions.
- `frontend/src/renderer/components/ActivityStream.tsx` — compact five-row activity rail, current operation, details, bounded command output, Stop, Retry and Copy details.
- `frontend/src/renderer/components/OmpChrome.tsx` — startup transcript, TUI composer, model/thinking listboxes, slash suggestions and status-line controls.
- `frontend/src/renderer/components/Overlays.tsx` — keyboard-driven settings dialog and command palette with roving tab/row focus.
- `frontend/src/renderer/components/Pages.tsx` — capability/preview pages and focus-safe skill-install dry-run dialog.
- `frontend/src/shared/contracts.ts` — renderer/main/API/activity contracts.
- `frontend/src/shared/preview-fixture.ts` — deterministic safe activity templates with stable IDs; future OMP events can replace this adapter without changing presentation.
- `frontend/src/shared/redaction.ts` — recursive diagnostic/RPC redaction.

## Supporting files

- `frontend/docs/SKILL_USAGE_LOG.md` — pre-source mandatory skill evidence.
- `frontend/docs/DESIGN_REFERENCES.md` and `DESIGN_INTENT.md` — official references, adaptation boundary and visual self-critique.
- `frontend/docs/INTERACTION_AUDIT.md` — complete control-family inventory and evidence mapping.
- `frontend/docs/VERIFICATION_REPORT.md` — baseline/final commands, exit codes, QA and environment limits.
- `frontend/scripts/run_browser_qa.py` — Chromium QA against transpiled actual TS/TSX sources, including responsive screenshots and 101 interaction checks.
- `frontend/scripts/run_fallback_typecheck.mjs` — semantic fallback used only when package installation is unavailable.
- `frontend/scripts/run_core_verification.mjs` — dependency-independent execution of activity, fixture, redaction, settings and project-boundary logic.
- `frontend/scripts/build-browser-verification.mjs` — temporary browser bundle builder for verification; generated bundle is excluded from delivery.
- `frontend/artifacts/ui-before/` and `frontend/artifacts/ui-after/` — reviewed baseline and final screenshots.
- `frontend/vite.config.mts` — renderer build and Vitest configuration.
- `frontend/tsconfig.node.json` — main/preload CommonJS build.
- `frontend/package.json` — `dev`, `typecheck`, `test`, `build` and `start` commands; no lint script is defined.

## Runtime flow

`Composer prompt → api.agent.preview() → typed PreviewReply → ActivityRun adapter → abort-aware runner → ActivityStream inside transcript → one final assistant recap on success`.

The deterministic fixture emits only observable safe summaries (`explore/read/plan/edit/command/verify/complete/error/cancelled`). It does not contain private chain-of-thought. Presentation components do not invent backend events or random progress.

## Boundaries

- Renderer never receives raw provider state or secrets.
- Real agent execution remains disabled; preview responses are deterministic and typed.
- Cancellation uses `AbortController`; timers/listeners are cleared and cancelled runs cannot emit late completion updates.
- Command output shown in the transcript is capped to the last 20 lines.
- External marketplace content runs in a separate sandboxed `WebContentsView` partition.
- Settings writes are normalized and atomic.
- Project files are read only through the isolated preload API and canonicalized in the main process.
- Electron window keeps `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`.

## Current UI flow

`Environment flyout → Browser chat / Sources tree → central transcript or source viewer → floating Inspector`. Side panels open over the workspace without replacing the transcript. The composer status line owns model, reasoning, project, context, runtime refresh and send. OMP settings use a focused terminal frame; capability pages are safe previews. Activity appears inline with the conversation and exposes current work immediately while completed details remain collapsed.

## Verification

Standard package-backed commands:

- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm start` (Electron smoke)

Environment-independent evidence commands:

- `node scripts/run_fallback_typecheck.mjs`
- `node scripts/run_core_verification.mjs`
- `node scripts/build-browser-verification.mjs`
- `python3 scripts/run_browser_qa.py`

Updated: 2026-08-06.
