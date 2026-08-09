# Windows build and installer

Mahiko targets Windows x64 with an assisted NSIS installer. The installer
contains the Electron application and the checksum-verified official
`omp-windows-x64.exe` from OMP `17.2.9`.

## Clean Windows build

```powershell
npm ci
npm run typecheck
npm run dist:windows
```

The command downloads the pinned OMP asset, verifies its SHA-256, builds the
Electron renderer/main process and creates
`release/mahiko-0.1.1-beta.2-x64-setup.exe`.

At first launch, Mahiko performs the visible OMP search and replacement flow.
The NSIS installer itself does not silently overwrite OMP. Application data is
also preserved when Mahiko is uninstalled (`deleteAppDataOnUninstall: false`).

The GitHub Actions workflow `.github/workflows/build-windows.yml` performs the
same build on `windows-latest` and uploads the installer as a workflow artifact.
