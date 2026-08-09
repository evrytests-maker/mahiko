# OMP executable replacement and data safety

Mahiko `0.1.1-beta.2` packages the official OMP `17.2.9` executables. The first-run
screen searches for an existing OMP installation and requires explicit consent
before replacing it. The operation is intentionally file-only: no OMP data
directory is ever removed, renamed or copied.

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

## Replacement boundary

Mahiko enforces all of the following:

1. The bundled executable must match the pinned SHA-256 and report `17.2.9`.
2. A replacement target must be a file or symlink named `omp`/`omp.exe` inside
   the current user's home or `%LOCALAPPDATA%`.
3. Anything inside `~/.omp` is explicitly rejected as a replacement target.
4. System locations such as `/usr/bin`, `/usr/local/bin` or `Program Files`
   are never changed and Mahiko never elevates itself to bypass permissions.
5. The new executable is written beside the target and version-checked before
   the old executable is renamed.
6. The replacement is checked again; a failure restores the previous file.
7. Only after successful verification is the old executable file removed.

There is no recursive delete operation in the OMP replacement implementation.
The data-location list is informational and never passed to a write/delete API.
