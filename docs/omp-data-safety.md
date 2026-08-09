# OMP CLI installation and data safety

Mahiko `0.1.1-beta.2` does not package OMP. The first-run screen searches for a
compatible CLI and requires explicit consent before executing the official
`17.2.9` installer in binary mode. The resulting executable is shared by
Mahiko and terminal users; no OMP data directory is removed, renamed or copied.

## Paths established from OMP 17.2.9

The authoritative directory resolver is OMP's tagged
[`packages/utils/src/dirs.ts`](https://github.com/can1357/oh-my-pi/blob/v17.2.9/packages/utils/src/dirs.ts).
The official binary destinations are defined by the tagged
[`scripts/install.sh`](https://github.com/can1357/oh-my-pi/blob/v17.2.9/scripts/install.sh)
and [`scripts/install.ps1`](https://github.com/can1357/oh-my-pi/blob/v17.2.9/scripts/install.ps1).

| System | Official standalone executable | Default data root |
| --- | --- | --- |
| Linux | `$HOME/.local/bin/omp` | `$HOME/.omp` |
| Windows | `%LOCALAPPDATA%\omp\omp.exe` | `%USERPROFILE%\.omp` |
| macOS | `$HOME/.local/bin/omp` | `$HOME/.omp` |

Important data below the default root includes:

- `~/.omp/agent/agent.db` — settings and account/auth storage;
- `~/.omp/agent/sessions` — chat/session transcripts;
- `~/.omp/agent/history.db` and `~/.omp/agent/blobs` — history and session blobs;
- `~/.omp/profiles/<name>/agent` — named profiles;
- project-local `.omp` directories — project configuration.

OMP also supports `PI_CODING_AGENT_DIR`. On Linux and macOS, an explicitly
migrated installation can place data/state/cache under
`$XDG_DATA_HOME/omp`, `$XDG_STATE_HOME/omp` and `$XDG_CACHE_HOME/omp`.

## Installation boundary

Mahiko enforces all of the following:

1. Release packages and the source repository contain no OMP executable.
2. The installer scripts and release assets are pinned in `omp.lock.json`.
   Mahiko streams the selected tagged script to a private temporary directory
   and verifies its SHA-256 before execution.
3. Linux executes `install.sh --binary --ref v17.2.9` with
   `PI_INSTALL_DIR=$HOME/.local/bin`. Windows executes
   `install.ps1 -Binary -Ref v17.2.9` with
   `PI_INSTALL_DIR=%LOCALAPPDATA%\omp`; the official Windows installer adds
   this directory to the user `PATH`.
4. The Windows installer's temporary `USERPROFILE` is isolated so its optional
   shell discovery cannot write to the real `%USERPROFILE%\.omp`. This
   temporary profile is removed after the child process exits.
5. A previous executable at the official CLI target is renamed to a unique
   sibling backup before installer execution. Exact `omp/17.2.9` output and
   the pinned asset SHA-256 are verified afterward. Any installer, timeout,
   version or checksum failure restores the previous executable.
6. Other external PATH/system OMP files and all OMP data locations are never
   write targets; Mahiko never elevates itself or invokes a package manager.

Recursive cleanup is limited to the exact private directory returned by
`mkdtemp` for the installer script and isolated Windows profile. The
data-location list is informational and never passed to a write/delete API.
