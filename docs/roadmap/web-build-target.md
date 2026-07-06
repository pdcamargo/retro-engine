# Web Build Target

- **Created:** 2026-05-21
- **Status:** In progress (`.rpak` format shipped 2026-07-06)
- **ADR:** [ADR-0151](../adr/ADR-0151-web-export-and-rpak.md)

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
packed `.rpak`). Verified end-to-end headlessly. Remaining below: the CLI, the
studio menu, and the in-browser run proof.

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
