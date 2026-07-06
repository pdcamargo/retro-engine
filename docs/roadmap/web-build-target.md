# Web Build Target

- **Created:** 2026-05-21
- **Status:** In progress (runtime host + CLI + in-browser run proof shipped 2026-07-06)
- **ADR:** [ADR-0151](../adr/ADR-0151-web-export-and-rpak.md) · [ADR-0153](../adr/ADR-0153-web-runtime-host.md)

## Delivery format — `.rpak` (✅ 2026-07-06)

Shipped in `@retro-engine/build` (ADR-0151): the `.rpak` v1 archive (magic +
version → JSON TOC → per-entry blobs), `writeRpak` (build-time, gzip via Web
Streams + `node:zlib` fallback, FNV-1a integrity), `RpakReader` (in-memory), and
`RangeRpakReader` (lazy GUID-addressed reads over an injected byte-range fetch —
the basis for HTTP-Range streaming). Plus the `ExportTarget`/`ExportRegistry`
interface.

## Web adapter (✅ 2026-07-06)

`bundleUserCode` (Bun bundler wrapper — browser/ESM, externals/minify/sourcemap),
`emitIndexHtml` (pure boot page), and `WebExportTarget` (bundle + `index.html` +
packed `.rpak`). Verified end-to-end headlessly.

## Runtime host + CLI + run proof (✅ 2026-07-06)

`@retro-engine/runtime-web` (`bootWebGame`, ADR-0153) is the browser runtime host
that turns a project's `ProjectDefinition` into a running `App` (resolves canvas
→ WebGPU renderer → adds plugins → runs). `WebExportTarget` now bundles a
generated boot entry (`emitWebBoot`) that calls it, so the produced `main.js`
actually boots. `parseProjectDescriptor` (in `@retro-engine/project`) reads
`project.retroengine`; `runWebExport` + a `retro-build` CLI (`retro build
--target web`) drive an export from the project root.

**Run proof:** `@retro-engine/sample-game` (asset-free — a 2D camera + MSDF
`Text2d` via the built-in font) exports through the CLI and **runs in a real
browser** — WebGPU initializes, text renders crisply, and the frame loop
animates a spinning label (verified via Playwright screenshot + console).

Remaining below: the studio "Build → Web" menu, packing `assets/` into the
`.rpak` (currently assets aren't bundled), and source maps / production polish
(phase 6).

## Asset delivery — planned (the big remaining Export gap)

Exported games currently load **no** project assets (the `.rpak` write path
exists but nothing packs a project's `assets/` or reads them back at runtime).
The pieces are in place; wiring them is a focused multi-phase effort:

- **Injection point (confirmed):** `AssetSource.read(location): Promise<Uint8Array>`
  (`@retro-engine/assets`) is the runtime seam — one source injected at App
  startup, exactly as the renderer backend is. The `AssetServer`
  (`packages/engine/src/asset/asset-server.ts`) resolves a GUID → location via
  an `AssetManifest` (`setManifest` / `loadManifest`), then calls
  `source.read(location)` and the extension/kind importer.
- **Phase A — build-time scan + pack ✅ (2026-07-06):** `scanProjectAssets`
  (`@retro-engine/build`) walks a project's `.meta` sidecars → an `AssetManifest`
  (GUID→location/kind) + each asset's bytes; `WebExportTarget` writes
  `manifest.json` + a GUID-keyed `.rpak` beside the bundle. Verified: the
  sample-game export emits both; the packed asset reads back by GUID and the
  manifest parses.
- **Phase B — runtime source ✅ (2026-07-06):** `RpakAssetSource`
  (`@retro-engine/runtime-web`) over `RangeRpakReader` (`httpRangeFetch`, robust
  to non-Range `200` servers), imported via the new browser-safe
  `@retro-engine/build/rpak` subpath. `bootWebGame({ assets })` fetches
  `manifest.json`, adds `AssetPlugin({ source })`, and `setManifest`s — before the
  game's plugins. Verified: the sample export bundles the reader for the browser
  and boots (fetches manifest + wires the source in-browser); `RpakAssetSource.read`
  is unit-tested end-to-end over a real archive.
- **Phase C — proof ✅ (2026-07-06):** the `sample-game` export packs a
  `credits.txt` asset; at runtime it registers a text loader, `loadByGuid`s it,
  and the value streams in from the `.rpak` over HTTP and is consumed by a system
  (shown as "CREDITS: LOADED"; `window.__game.credits` matches the file exactly).
  End-to-end asset delivery confirmed in a real browser (Playwright). A textured
  `Sprite`-from-`.rpak` (image decode + GPU) is a further demo, not needed for the
  delivery proof.

Resolved sub-question: `CorePlugin` does **not** add an `AssetServer`, so
`bootWebGame` adds `AssetPlugin({ source })` itself (before the game's plugins).

## Remaining for the Export P0 check-off

- **Studio "Build → Web" menu** — wrap `runWebExport` behind the studio's Build
  menu (studio-side; needs the studio to verify).
- **Source maps / production polish** (phase 6).

## Goal

A CLI (or studio menu) that takes a Retro Engine project and produces a deployable static web bundle: `index.html`, JS bundles, asset manifest, all assets, ready to upload to any static host. Counterpart to the studio producing desktop Tauri bundles.

## Phases

1. **Project model** — a Retro Engine project is a directory with a manifest, scenes, assets, and code (TypeScript that imports `@retro-engine/engine`).
2. **Bundler choice** — Bun's bundler likely sufficient. If not, esbuild or rolldown.
3. **Asset pipeline** — copy/transform assets into the output, write a manifest, embed GUID → URL mapping.
4. **CLI** — `retro build --target web` from the project root.
5. **Studio menu** — "Build → Web" wraps the CLI.
6. **Source maps + minification** — production-grade output.

## Open questions

- How does WebGPU feature detection at startup work? Backend picks WebGPU if available, otherwise WebGL2 (once the backend exists), otherwise errors with a helpful message.
- Asset CDN strategy: in-bundle vs separately hosted? Both should be supported.
- Code splitting: per-scene chunks?

## Links

- ADR-0003 — renderer HAL (selection happens here)
- ADR-0004 — publishing (the CLI itself is a published package, name TBD)
