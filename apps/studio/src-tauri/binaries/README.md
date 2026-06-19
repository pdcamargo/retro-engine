# Sidecar binaries

The Bun runtime is shipped as a Tauri sidecar (`externalBin: ["binaries/bun"]` in
`tauri.conf.json`) so the studio can `bun install` + build a user's project without
requiring the user to install a JS runtime.

The binary is **not committed**. It is fetched per target triple before `tauri build`:

```
binaries/bun-aarch64-apple-darwin
binaries/bun-x86_64-apple-darwin
binaries/bun-x86_64-pc-windows-msvc.exe
binaries/bun-x86_64-unknown-linux-gnu
```

`.github/workflows/studio-release.yml` downloads the matching Bun release into this
directory with the correct platform suffix. For a local `tauri build`, drop the
appropriately-suffixed `bun` here yourself (copy your installed Bun and rename it).
