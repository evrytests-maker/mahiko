# Task 3 — debug, verify and release

Begin only after Tasks 1 and 2 are accepted. Use systematic-debugging for every failure and fix root causes rather than symptoms.

Run unit, fake-process and integration tests; typecheck; production build; real no-prompt OMP probe; Electron smoke; browser interaction checks; responsive screenshots; and Linux packaging for AppImage, deb, rpm and tar.gz. Check that the renderer never reports fake runtime success and that incompatible OMP never reaches RPC startup.

Record exact commands, exit codes, environment limitations and reviewed screenshots. Update `info.md`. Apply verification-before-completion immediately before the final claim and release commit.

