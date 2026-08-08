# Start here — merge the staged frontend with OMP

You are authorized to begin the Mahiko integration now.

Read `AGENTS.md`, root `info.md`, `project-map/info.md`, and then the ordered tasks in `prompts/01-import-final-frontend.md`, `02-connect-live-omp.md`, and `03-debug-verify-release.md`. Execute them in order, stopping at a real blocker rather than simulating success.

## Source and architecture boundaries

- `frontend/` is the supplied, visually verified frontend and the only UI source of truth. Preserve it as an unchanged handoff; integrate by adapting/copying into the root app.
- Root `src/main`, `src/preload`, `src/shared` and `omp.lock.json` define the secure integration boundary. Reconcile overlaps deliberately; do not overwrite same-named files blindly.
- OMP is external and must be exactly `17.2.9`. Never copy `~/.omp`, credentials or sessions into the repository.
- Remove mock/deterministic agent success from the integrated product. Unsupported or disconnected states must be honest.

## Explicit verification permissions

You may control the local Mahiko UI in the available in-app browser or Chrome tooling: open the local URL, click controls, type into fields, exercise keyboard flows, resize viewports, inspect console output and capture screenshots. Use the browser-control skill/tool available in the environment and verify the real integrated renderer rather than a recreated fixture.

You may start the external OMP 17.2.9 process and send bounded test RPC requests and harmless test prompts needed to verify prompt, stream, tool, stop/cancel and extension-UI integration. Keep tests inside `/home/pupsik/mahiko`, prefer ephemeral/no-session runs, avoid destructive commands, redact secrets and stop spawned processes after each check. A test prompt may ask OMP to return a fixed short phrase or inspect a harmless fixture created for the test; it must not modify unrelated user files or external services.

Discovery/version checks still send no prompt. Real prompts are authorized only once the live integration under test is ready and only for verification evidence.

## Working standard

Use Ponytail for the smallest working integration, frontend-design for visual fidelity and responsive/accessibility quality, systematic-debugging for failures, and verification-before-completion before any success claim. Do not add dependencies or abstractions without measured need.

Keep long logs and screenshots under `.codex/scratch/`. Update `info.md` after structural changes. Before finishing, run the full Task 3 matrix and report exact evidence, including screenshots and the OMP requests that were actually exercised.
