# Mahiko

Mahiko is a buildable Electron workspace prepared for a later, deliberate merge of the supplied final frontend with an external OMP 17.2.9 installation.

## Current state

- `frontend/` is the unpacked frontend supplied in `ma-hi-ko-ui-visual-verified.zip`. It is staged unchanged and is not wired into the root application.
- `project-map/` is the map supplied with that frontend. It is preserved separately as source documentation.
- `src/` is a small integration shell. It discovers OMP, requires the exact locked version and exposes read-only runtime status through an isolated preload API.
- Live prompt execution is intentionally absent. The root renderer reports only observed runtime state.

The imported archive had SHA-256 `eaed5a758d95f9b140d058d889d68927d81bd34083ce792bc00e6845cc91d3cd`. Its bundled `skills/` directory was not imported.

## Requirements

- Node.js 22+
- npm
- External `omp` version `17.2.9` for runtime probing
- Native package tooling required by electron-builder for the chosen Linux target

## Commands

```bash
npm install
npm run typecheck
npm test
npm run build
npm run check:omp
npm run pack:linux
npm run dist:linux
```

`dist:linux` builds AppImage, deb, rpm and tar.gz artifacts for x64 Linux. The source remains portable across Linux distributions; distributable files are generated rather than committed.

The future merge starts with `prompts/00-start-merge.md`, followed by tasks 01–03. The start prompt explicitly permits local browser interaction, screenshots and bounded harmless OMP requests for integration verification. Do not execute it until the merge run is explicitly authorized.
