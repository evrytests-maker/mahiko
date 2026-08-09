# Linux build and packages

## Reproducible source path

Use a clean checkout, Node.js 22 and the committed `package-lock.json`:

```bash
npm ci
npm run typecheck
npm run build:source
npm run pack:linux
```

`build:source` builds Mahiko without downloading OMP. `pack:linux` creates an unpacked x64 application. `npm run dist:linux` additionally creates AppImage, deb, rpm and tar.gz artifacts in `release/`. None of these artifacts contains an OMP executable. The CI workflow performs a clean Node 22 build and packages the Linux targets on Ubuntu 24.04.

## Build-host preparation

Package names vary; review the transaction before installing anything.

- Fedora/DNF: Node.js 22, npm, `rpm-build`, `git`, `make`, GCC/G++, Python 3 and the Electron/electron-builder runtime libraries.
- Arch/pacman: `nodejs-lts-jod`, npm, `base-devel`, git, Python and, when building RPM metadata on Arch, an RPM toolchain.
- Void/xbps: `nodejs`, npm, `base-devel`, git, Python and target-specific packaging tools available for the host architecture.

The distro-neutral unpacked and tar.gz paths need fewer target-specific tools than creating native deb/rpm packages. AppImage may require FUSE 2 to run mounted; `--appimage-extract` provides a no-mount inspection path.

## Runtime libraries

Electron normally requires GTK 3, NSS, ALSA, ATK/AT-SPI, GBM, X11/XCB-related libraries and a desktop session. Exact package names depend on the distribution and are also declared by the generated native package metadata. On first launch Mahiko asks for consent before executing the tagged official OMP installer as `install.sh --binary --ref v17.2.9`. It installs the shared user CLI at `$HOME/.local/bin/omp`; Mahiko and terminal OMP then use the same normal OMP data roots. The executable is checked against the pinned SHA-256 and exact `omp/17.2.9` output, with rollback on failure.

## Verification boundary

Static package verification covers metadata, architecture, dependency declarations, desktop entry, icon and payload. Actual `dnf install`/uninstall requires a disposable Fedora-compatible system or container with package-manager privileges; source builds on Arch and Void require those respective clean hosts. The final verification report must distinguish completed checks from these host-dependent steps.
