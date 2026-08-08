# Pinned OMP runtime

Mahiko packages the official OMP `17.2.9` release executables described by
`manifest.json`. The executable files are larger than GitHub's normal 100 MiB
file limit, so they are not committed to Git. `scripts/vendor-omp.mjs`
downloads them from the pinned upstream release and verifies their SHA-256
digests before electron-builder can package them.

Commands:

```bash
npm run vendor:omp          # current platform
npm run vendor:omp:linux    # Linux x64
npm run vendor:omp:windows  # Windows x64
npm run vendor:omp:all      # both release targets
```

The upstream OMP project is MIT-licensed. Its license is preserved in this
directory and copied into every Mahiko package next to the executable.
