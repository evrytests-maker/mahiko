# Mohiko prefill

Start with `info.md` and obey `AGENTS.md`.

The supplied UI lives unchanged in `frontend/`; its original map is in `project-map/`. Root `src/` is the integration shell. When the user asks to start the merge, begin with `prompts/00-start-merge.md` and preserve `frontend/` as an unchanged handoff.

Use exact OMP `17.2.9` from `omp.lock.json`. Never copy OMP state or send a prompt during discovery. Report real runtime state only. Preserve Electron isolation and keep changes minimal.

For an explicitly authorized merge run, browser control, screenshots and bounded harmless OMP test prompts are allowed under the limits in `AGENTS.md` and `prompts/00-start-merge.md`.

Use the relevant repository skill before coding or debugging. Run fresh typecheck, tests and build before declaring success; packaging and UI checks are required when those surfaces change. Update `info.md` after structural changes.
