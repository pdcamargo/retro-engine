---
'@retro-engine/build': minor
---

feat(build): pack project assets into the export — scan + .rpak + manifest (web export asset phase A)

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
