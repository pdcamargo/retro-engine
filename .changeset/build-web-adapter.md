---
'@retro-engine/build': minor
---

feat(build): web export adapter — Bun bundler + index.html + .rpak (web export phase 2)

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
