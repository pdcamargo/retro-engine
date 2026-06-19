# Standalone Studio — runtime integration

- **Created:** 2026-06-19
- **Status:** Planning

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

1. **Runtime-verify + harden native integration** — `tauri dev`/`tauri build` with a real
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

## Open questions

Each likely becomes a decision ADR.

- **Thumbnail caching.** Cache to the git-ignored `.re/` machine cache (keyed by GUID +
  content hash, invalidated on change) vs regenerate in-memory each session. Trade-offs:
  cold-open speed vs disk footprint vs staleness vs cross-machine portability.
- **Hot-reload granularity.** Hot per-system swap without a full App-rebuild (needs new
  engine support for removable/replaceable systems on a running schedule — ADR-0091
  deferred it) vs keep App-rebuild-on-change.
- **Binary IPC.** How project file bytes cross the Tauri boundary efficiently (raw
  request/response vs the current JSON number arrays) — small docs vs large assets.
- **Scope tightening.** Per-project asset-protocol + fs-watch scopes vs the v0 `$HOME/**`.

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
