# Windows build and installer

Mahiko targets Windows x64 with an assisted NSIS installer. The installer does
not contain OMP.

## Clean Windows build

```powershell
npm ci
npm run typecheck
npm run dist:windows
```

The command builds the Electron renderer/main process without downloading OMP and creates
`release/mahiko-0.1.1-beta.2-x64-setup.exe`.

At first launch, Mahiko performs the visible OMP search. If no compatible OMP
is found, explicit consent executes the tagged official installer as
`install.ps1 -Binary -Ref v17.2.9`. It installs the shared user CLI at
`%LOCALAPPDATA%\omp\omp.exe` and adds that directory to the user `PATH`.
Mahiko isolates only the installer process profile so the installer's optional
bash discovery cannot edit the real `%USERPROFILE%\.omp`; later Mahiko and
terminal OMP use the same real profiles, sessions and accounts. The executable
is checked against the pinned SHA-256 and exact `omp/17.2.9` output, with
rollback on failure. Application data is preserved when Mahiko is uninstalled
(`deleteAppDataOnUninstall: false`).

The GitHub Actions workflow `.github/workflows/build-windows.yml` performs the
same build on `windows-latest` and uploads the installer as a workflow artifact.
