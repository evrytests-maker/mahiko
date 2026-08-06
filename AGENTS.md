# Mohiko agent instructions

Read `info.md` before exploring the repository. Keep it current when entry points, top-level directories, commands or subsystem boundaries change.

## Current boundary

- Treat `frontend/` as an immutable, unpacked frontend handoff. Do not edit, move, install inside, or connect it to the root application until the user explicitly authorizes the merge.
- Treat `project-map/` as the handoff's original map. Preserve it for comparison; `info.md` is the map for the combined workspace.
- Do not import the archive's `skills/`, `node_modules/`, generated output or credentials into the integration shell.
- Do not execute any prompt under `prompts/` automatically. They are staged handoff tasks; the next integration agent starts from `prompts/00-start-merge.md` when the user authorizes that run.
- OMP is external. Never copy `~/.omp`, credentials, sessions or provider state into this repository.

## Runtime contract

- The only supported OMP version is the exact version in `omp.lock.json`.
- A mismatched binary is reported as incompatible and must not be started in RPC mode.
- Probe `--mode rpc-ui` and protocol v2 first, then fall back to `--mode rpc` only when readiness fails.
- The renderer must display observed state. Do not create fake-success APIs, simulated agent output or hidden prompt execution.
- Keep Electron isolation enabled: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`.

## Authorized merge verification

- During the explicit merge task, the agent may control the local UI with available in-app browser or Chrome tooling, click/type through real controls, inspect console output, resize viewports and capture screenshots.
- During that task, the agent may send bounded, harmless test requests and prompts to the exact OMP 17.2.9 process to verify live integration. Prefer ephemeral/no-session runs, constrain effects to this repository, redact secrets and terminate test processes.
- Runtime discovery and version probing remain prompt-free. Prompt execution is authorized only as integration testing after the live gateway exists.

## Working method

- Use the smallest change that meets the current request.
- Use the four repository skills when their trigger applies: Ponytail, project-context-index, systematic-debugging and verification-before-completion.
- Put disposable notes and logs in `.codex/scratch/`.
- Before claiming completion or committing, run the checks appropriate to the changed area and report their actual results.
