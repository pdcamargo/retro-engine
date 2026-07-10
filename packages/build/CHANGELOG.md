# @retro-engine/build

## 0.1.0

### Minor Changes

- 2ea4d68: feat(build): bake `.meta` import settings into the export manifest

  Exported games now apply per-asset import settings (a texture's `filter` /
  `colorSpace`, etc.) — previously lost because the `.meta` sidecars weren't packed
  into the `.rpak`, so every texture fell back to the project default (ADR-0172).

  `AssetManifestEntry` gains an optional `meta` field (the sidecar's fields beyond
  `version`/`guid`/`kind`); the build scan (`parseMetaEntry`) bakes it, and
  `RpakAssetSource` synthesizes the `<name>.meta` read from it — so the engine's
  image importer (which reads `ctx.read('<name>.meta')`) gets the settings in the
  bundle unchanged. Assets whose sidecar carries no settings get no `meta`, keeping
  the manifest lean; the importer's "no sidecar → defaults" path is preserved.
  Generic (any sidecar-reading importer benefits). Unit-tested; the sample-game
  export manifest is unchanged for its settingless asset.

- cbc37d3: feat(build): pack project assets into the export — scan + .rpak + manifest (web export asset phase A)

  `retro build` now scans a project's `.meta` sidecars, packs each asset into the
  `.rpak`, and emits the GUID→location manifest — the build-time half of web asset
  delivery (ADR-0151).

  - `scanProjectAssets(projectRoot)` walks the project (skipping node_modules /
    dist / .re / .git / .turbo), parses each `.meta` (`{ guid, kind }`; location =
    sidecar path minus `.meta`), reads the asset bytes, and returns the baked
    `AssetManifestFile` + GUID-keyed `RpakInput[]`. Orphan sidecars are skipped.
    `parseMetaEntry` is the pure per-sidecar parser.
  - `WebExportTarget` gains a `manifest` config → writes `manifest.json` beside the
    bundle. `runWebExport` runs the scan and packs the result.
  - New `@retro-engine/assets` dependency (manifest bake/serialize).

  Verified: the `sample-game` export now emits `assets.rpak` + `manifest.json`; the
  packed asset reads back by GUID through `RpakReader` and the manifest parses.
  The runtime side (a browser `RpakAssetSource` wired into the App's `AssetServer`)
  is phase B; this ships the artifact half.

- 4d52335: feat(build): new @retro-engine/build package with the .rpak asset format (web export phase 1)

  Introduces the export pipeline package and its delivery format:

  - `.rpak` v1 — magic + version header → JSON table of contents
    (guid / offset / length / codec / uncompressedLength / hash) → concatenated
    per-entry blobs.
  - `writeRpak` — packs assets (build time), gzip per entry via Web Streams with a
    `node:zlib` fallback, FNV-1a content hashes for integrity.
  - `RpakReader` — reads an in-memory archive by GUID (slice → decompress →
    verify).
  - `RangeRpakReader` — lazy, GUID-addressed reads over an injected byte-range
    fetch: `open()` pulls only the header + TOC, each `read()` only that asset's
    range — the basis for HTTP-Range asset streaming in the browser.
  - `ExportTarget` / `ExportRegistry` — the pluggable-target interface the web
    adapter registers against.

  The reader layer is browser-safe. Bundling user code + the web adapter that
  emits a static site and writes the project `.rpak` land in a later phase.

- 25376d8: feat(build): export `runWebExport` (+ its option/result types) as public API

  `runWebExport` was internal to the `retro-build` CLI. Promote it to the package
  entry point so hosts (e.g. the studio "Build → Web" menu) can run a web export
  programmatically through the public API instead of reaching into `src/`.

- 78034c1: feat(build): web export adapter — Bun bundler + index.html + .rpak (web export phase 2)

  Turns a project into a deployable static site:

  - `bundleUserCode` — a typed Bun-bundler wrapper (browser/ESM, configurable
    externals, minify, source maps) that bundles the user's code.
  - `emitIndexHtml` — a pure generator for the boot `index.html` (full-viewport
    canvas + module script, optional `.rpak` preload).
  - `WebExportTarget` — the `'web'` `ExportTarget`: bundles the entry, writes the
    bundle + `index.html`, and packs the project's assets into a `.rpak` beside
    them, returning the produced file list.

  Verified end-to-end headlessly: a fixture entry bundles, the emitted site
  references the bundle + archive, and the packed `.rpak` reads back through
  `RpakReader`. The `retro build` CLI, the studio "Build → Web" menu, and the
  in-browser run proof are the remaining pieces of the web export item.

- 1f174eb: feat(runtime-web): runtime .rpak asset delivery — RpakAssetSource + bootWebGame wiring (web export asset phase B)

  Exported games can now load their packed assets. `bootWebGame` fetches the
  manifest, opens a `.rpak`-backed asset source, and binds it to the App's
  `AssetServer` before the game's plugins run — so their loaders resolve GUIDs from
  the archive over HTTP.

  **`@retro-engine/runtime-web`:**

  - `RpakAssetSource` — an `AssetSource` reading assets from a `.rpak` by GUID,
    resolving the server's location-based `read` through the project manifest
    (location → GUID). Opens the archive lazily (one header + TOC fetch), then
    streams each entry's byte range.
  - `httpRangeFetch(url)` — a `RangeFetch` over HTTP `Range`, robust to servers
    that ignore the range and return the whole body (`200`) by slicing locally.
  - `bootWebGame({ assets: { rpakUrl, manifestUrl } })` — wires the above (fetch
    manifest → `AssetPlugin({ source })` → `setManifest`); sets `window.__retroAssets`.

  **`@retro-engine/build`:**

  - New browser-safe `@retro-engine/build/rpak` subpath (reader / format / Web
    Streams compression / hash + `writeRpak`) so a browser runtime imports the
    `.rpak` code without the Node-only export pipeline.
  - `emitWebBoot` forwards the asset URLs; `WebExportTarget` passes them when it
    packs a `.rpak` + manifest.

  Verified: the `sample-game` export bundles the reader for the browser and boots —
  `bootWebGame` fetches `manifest.json`, wires the source, and reports one manifest
  entry in-browser; the `.rpak` serves + parses. `RpakAssetSource.read` is unit-tested
  end-to-end over a real archive. A sprite-from-`.rpak` proof is phase C.

- a2b79eb: feat(build): web runtime host (`bootWebGame`) + `retro build` CLI (web export phase 3)

  Closes the gap between a bundled project and a running game, and gives the web
  export a command-line entry point. A real asset-free project now exports and
  runs in a browser end-to-end.

  **New `@retro-engine/runtime-web`** — the browser runtime host (ADR-0153):

  - `bootWebGame(definition, options?)` resolves the render canvas, creates a
    renderer backend (WebGPU by default, injectable), constructs the `App`, adds
    every project plugin in order, and starts the frame loop. The shipped-game
    counterpart to the studio's editor host.
  - `resolveCanvas(target, doc?)` — resolves an `HTMLCanvasElement` or element id.

  **`@retro-engine/build`:**

  - `emitWebBoot(options)` — emits the boot-entry source that hands a project's
    `ProjectDefinition` to `bootWebGame`. `WebExportTarget` now bundles this
    generated entry (engine + backend inlined) so the produced `main.js` actually
    boots the game, keeping the user's `src/game.ts` a pure declaration.
  - `runWebExport(options)` + a `retro-build` CLI (`retro build --target web`):
    reads `project.retroengine`, resolves the build entry, and writes a static
    site to `<project>/dist/web`.
  - Production bundling keeps `identifiers: false` so component constructor names
    survive minification for reflection-based scene serialization.

  **`@retro-engine/project`:**

  - `parseProjectDescriptor(toml)` / `ProjectDescriptor` — the shared parser for
    the `project.retroengine` manifest (entry, startup scene, metadata).

  Verified end-to-end: an asset-free sample project (`@retro-engine/sample-game`)
  exports via the CLI, and the produced static site boots in a real browser —
  WebGPU initializes, the engine renders MSDF text, and the frame loop animates a
  spinning label. The studio "Build → Web" menu and packing `assets/` into the
  `.rpak` remain.

- ce20898: feat(runtime-web): load the project's startup scene in the web export (ADR-0173)

  A scene-driven project (entities authored in a `.rescene`) now boots with its
  world in the web export, not an empty one. `bootWebGame` gains a `startupScene`
  option; when set it installs a game-runtime baseline via the new
  `installGameRuntime` (render stack — prepass / StandardMaterial / lights /
  skybox — plus the scene + asset runtime with mesh/image/material/glTF loaders,
  every add guarded so a project can override) and loads + spawns the scene via
  `loadAndSpawnScene` before the run loop. The web export threads
  `descriptor.startupScene` from `runWebExport` → `WebExportTarget` → `emitWebBoot`.
  `App.hasPlugin(name)` is added to let a host install a baseline plugin only when
  the project has not supplied its own.

  Also fixes engine frustum culling of **skinned meshes**: they were culled by
  their mesh bind-pose AABB, which a posed/animated skeleton deforms beyond — so a
  character could wrongly vanish (it only showed in a multi-camera editor where
  another camera framed the bind box). Entities with a `Skeleton` now skip the
  bind-pose frustum test (like `NoFrustumCulling`), so posed characters render
  correctly under a single game camera. (Joint-derived skinned bounds are a
  tracked follow-up.)

### Patch Changes

- Updated dependencies [937f2cb]
- Updated dependencies [d5424c3]
- Updated dependencies [c1b257b]
- Updated dependencies [2ea4d68]
- Updated dependencies [c867984]
- Updated dependencies [3db9d87]
- Updated dependencies [67e8513]
- Updated dependencies [5451d30]
- Updated dependencies [acae153]
- Updated dependencies [a2b79eb]
  - @retro-engine/assets@0.1.0
  - @retro-engine/project@1.0.0
