# ADR-0093: Native project filesystem source/sink + dialogs

- **Status:** Accepted
- **Date:** 2026-06-19

## Context

ADR-0078 reserved `filesystem`/`dialogs` capability flags and stated the filesystem would
back the engine's **existing** `AssetSource`/`AssetSink` seam, not a new one. The standalone
studio now needs to read and write a real project folder on disk (and let the user pick
it), satisfying those interfaces so the engine load/save path is unchanged.

## Decision

- **Root-scoped Rust commands are the fs entry point.** `set_project_root` records the
  opened directory in Tauri-managed state; `project_read_file` / `project_write_file` /
  `project_read_dir` (recursive) resolve project-relative paths against it, rejecting `..`
  traversal in one place. App-local commands, same pattern as `pref_*` — no per-path static
  capability needed.
- **Reads route by use case behind one `AssetSource`.** `TauriProjectAssetSource` reads
  small structured docs (`.rescene`/`.reprefab`/`.meta`/`.rmesh`/JSON) as bytes over
  `project_read_file`, and large binaries (`.png/.ktx2/.glb/.bin/.ogg/.mp4…`) over the
  **asset protocol** (`convertFileSrc` → `fetch`), so the webview streams them natively with
  no IPC copy. `TauriProjectAssetSink` writes via `project_write_file`. Both satisfy the
  engine interfaces verbatim.
- **`openProject` is a dep-free `PlatformHost` method.** It returns the chosen directory
  path (native folder dialog via `@tauri-apps/plugin-dialog`, then `set_project_root`), or
  `null`. Present only when `dialogs` + `filesystem` are true; absent in the browser. The
  Tauri host flips both flags to true.
- **Browser fallback reuses the engine's HTTP source/sink** (`FetchAssetSource` +
  `HttpPostAssetSink`) against new dev-server `/project/*` GET/PUT routes scoped to
  `RETRO_PROJECT_DIR`. `createProjectIo(host, root)` picks native vs browser.
- **Asset-protocol scope** is `$HOME/**` for v0 (bounded to the user); `protocol-asset` is
  enabled on the `tauri` crate and `dialog:default` added to the capability set.

## Consequences

- The studio reads/writes a real project folder through the unchanged engine load/save
  path, with large assets streaming natively. Closes the intent of
  `docs/backlog/platform-filesystem-dialog-capabilities.md`.
- `project_read_file`/`write_file` marshal bytes as JSON number arrays over IPC — fine for
  small docs and one-shot saves; large assets avoid it via the asset protocol on read.
  Efficient binary IPC and a tighter (per-project) asset-protocol scope are follow-ups.
- Verified to the headless limit: `cargo check` confirms the commands, dialog plugin, and
  `protocol-asset` compile + config parses; the frontend typechecks. Live dialog + asset
  streaming need a running shell.

## Implementation

- `apps/studio/src-tauri/src/lib.rs` — `ProjectRoot` state, `set_project_root`, `project_read_file`, `project_write_file`, `project_read_dir`, dialog plugin init
- `apps/studio/src-tauri/Cargo.toml` — `tauri-plugin-dialog`, `tauri` `protocol-asset` feature
- `apps/studio/src-tauri/tauri.conf.json` — `assetProtocol` scope; `apps/studio/src-tauri/capabilities/default.json` — `dialog:default`
- `apps/studio/src/platform/tauri-platform-host.ts` — `filesystem`/`dialogs` true, `openProject`
- `apps/studio/src/project/tauri-project-io.ts` — `TauriProjectAssetSource`/`TauriProjectAssetSink`
- `apps/studio/src/project/project-io.ts` — `createProjectIo` (native vs browser)
- `apps/studio/dev-server.ts` — `/project/*` GET/PUT routes
- `packages/editor-platform/src/platform-host.ts` — `openProject?`
