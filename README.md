# mahiko

`mahiko` is a Linux and Windows Electron GUI that packages the official OMP `17.2.9` runtime. The integrated application provides live chat streaming, provider-visible thinking blocks, tool activity, Stop/Escape cancellation, models and reasoning controls, context compaction, project browsing, an embedded workbench, provider login/registration, account pools and Custom API configuration.

The original UI handoff is preserved unchanged in `frontend/`; the production application is built from the root `src/` tree.

## Requirements

- Node.js 22 and npm with the committed lockfile.
- Network access during the source/package build to fetch the pinned upstream OMP executable; runtime packages contain OMP and do not download it.
- Linux desktop libraries required by Electron.
- Packaging tools for the requested target; see [Linux build and packages](docs/linux-build.md).
- Windows packaging details are in [Windows build and installer](docs/windows-build.md).
- The audited replacement boundary is documented in [OMP data safety](docs/omp-data-safety.md).

## Build and run

```bash
npm ci
npm run typecheck
npm run build:source
npm run check:omp
npm start
```

Development mode is `npm run dev`. `npm run dist:linux` produces x64 AppImage, deb, rpm and tar.gz artifacts; `npm run dist:windows` produces the x64 NSIS installer in `release/`.

## Connect or register an account

Open the environment sidebar, choose **Подключения**, then **Провайдеры**. The list comes directly from OMP. **Подключить / регистрация** invokes OMP's real login flow; when OMP emits an HTTPS authorization URL, Electron opens it in the system browser. Complete credentials, CAPTCHA and provider confirmations there. The GUI waits for OMP to report the provider as authenticated.

The app never asks the model to register an account and never stores browser credentials in the renderer or repository.

## Account pools

In **Подключения → Аккаунты**, add the OMP provider id and one existing OMP identity per line, then select **Сохранить пул**. The file is written atomically with mode `0600` under Electron's user-data directory. Saving an active pool restarts the managed RPC client so the next process receives `OMP_AUTH_BROKER_ACCOUNT_POOL_FILE`.

Empty rows are ignored, duplicate provider ids are rejected, and no sample identities are inserted.

## Runtime and security contract

- Only the version pinned in `omp.lock.json` may start in RPC mode.
- `--mode rpc-ui` with protocol v2 is attempted first; `--mode rpc` is a readiness fallback.
- Renderer state is observed through a typed preload bridge. `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` remain enabled.
- Release packages contain only the checksum-verified OMP executable. `~/.omp`, XDG data, tokens, cookies, sessions and provider state remain external and are never copied into the project or package.
- Unsupported OMP 17.2.9 controls are visibly disabled with a reason; the application does not report simulated success.

See [the control matrix](docs/control-matrix.md) for UI-to-backend paths and [Linux build and packages](docs/linux-build.md) for distribution-specific preparation.

Provider-specific reasoning controls are summarized in [Thinking controls exposed through OMP](docs/thinking-models.md). The renderer reads OMP model metadata instead of hard-coding a universal effort ladder.
