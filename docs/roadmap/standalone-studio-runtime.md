# Standalone Studio — runtime integration

- **Created:** 2026-06-19
- **Status:** Phase 1 done (ADR-0099) · Phases 2–4 pending

## Goal

The "open / build / index / run a user project" layer shipped across ADR-0088…0098
(commits `5451d30`..`c867984`): project packages + scaffolder, `ctor.name` reflection,
YAML(`.rescene`)/TOML(`project.retroengine`)/`.meta`-sourced-manifest formats, the
host-bridge loader (user code shares the studio's live engine), App-rebuild on project
load, the Bun build sidecar, native fs source/sink + dialog, the project index, settings
TOML, file-watch routing, editor extensions, and `isEditorHint()`/`runInEditor()` tool
systems. The dogfood is the sibling `../retro-game-sample`.

But the native paths are **implemented + gate-green + unit/integration-tested, not
runtime-verified** — nobody has run `tauri dev`/`tauri build` end-to-end with the Bun
sidecar. Success for this initiative: a real native studio that opens `retro-game-sample`,
builds + loads its code, streams its assets on demand, shows asset thumbnails, and
hot-reloads on a code edit — proven on a live shell, not just the gate chain.

## Phases

1. **Runtime-verify + harden native integration** — ✅ **done (ADR-0099)**; proven on a live
   `tauri dev` shell against `../retro-game-sample`. — `tauri dev`/`tauri build` with a real
   per-platform bun in `src-tauri/binaries/`; prove Open Project dialog → `set_project_root`
   → `project_build` sidecar → host-bridge load → user content appears; fix what breaks.
   Known issues: `project_read_file`/`project_write_file` marshal bytes as JSON number
   arrays (move to ArrayBuffer/raw IPC); tighten the `$HOME/**` asset-protocol + fs-watch
   scopes to the opened project; confirm dev-vs-shipped build-script resource resolution.
   Closes `docs/backlog/platform-filesystem-dialog-capabilities.md` +
   `studio-scene-source-host-providers.md` on the user's confirmation.

2. **Scene-aware asset streaming** — replace the bulk-manifest preload with load-on-demand:
   the handle-ref scan (walk `SceneData` for `{assetType, GUID}` without decoding),
   background load on scene open, unload the outgoing set on scene swap, range/mip
   streaming over the `asset://` protocol. Advances `docs/backlog/scene-aware-asset-streaming.md`.

3. **Thumbnail generation** — asset-browser previews for images, meshes, scenes, prefabs
   (render meshes/scenes to an offscreen WebGPU texture; downscale images), async with
   placeholders. Cache or regenerate (see open questions).

4. **Code hot-reload** — make the watch→rebuild→App-rebuild loop real and verified (Phase 7
   wired the routing; execute the rebuild on a `*.ts` change), preserve editor state across
   reload, debounce/coalesce, surface build diagnostics in the Console.

## Open questions — RESOLVED (2026-06-19)

- **Thumbnail caching → disk `.re/` + content-hash + in-memory GPU LRU.** One 256px master
  per asset at `.re/thumbnails/<guid>.<hash8>.png` (content-hash invalidated), sampled at all
  zoom sizes; LRU of GPU textures on top. (Phase 3 / ADR-0101.)
- **Hot-reload granularity → per-system / per-plugin hot-swap on a running App** (no page
  reload). Overrides ADR-0091's deferral: serialize the user scene → remove user plugins'
  systems/components/resources/observers/hooks → re-add the rebuilt plugins → respawn against
  the name-keyed registry. (Phase 4 / ADR-0102.)
- **Binary IPC → raw `tauri::ipc::Response` / ArrayBuffer.** ✅ done in Phase 1 (ADR-0099).
- **Scope tightening → per-project at runtime** via `fs_scope()`/`asset_protocol_scope()
  `.allow_directory(root)` in `set_project_root`. ✅ done in Phase 1 (ADR-0099).

## Links

- Related ADRs: ADR-0088…0098 (this initiative's foundation); especially 0089 (formats),
  0090 (host-bridge loader), 0091 (App-rebuild), 0092 (Bun sidecar), 0093 (native fs I/O),
  0094 (project index), 0096 (file watching), 0098 (editor hint / tool systems).
- Related backlog: `scene-aware-asset-streaming.md`; `platform-filesystem-dialog-capabilities.md`,
  `studio-scene-source-host-providers.md`, `editor-human-readable-settings.md` (advanced by
  0088…0098, delete on confirmation).
- Code: `apps/studio/src/project/*`, `apps/studio/src-tauri/`, `apps/studio/dev-server.ts`,
  `packages/project/src/*`. Dogfood: `../retro-game-sample`.
- Memory: `project_standalone_studio.md`, `reference_bun_keep_names_broken.md`,
  `reference_studio_playwright_probes.md`.
