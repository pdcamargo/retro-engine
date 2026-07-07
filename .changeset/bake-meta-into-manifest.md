---
'@retro-engine/assets': minor
'@retro-engine/build': minor
'@retro-engine/runtime-web': minor
---

feat(build): bake `.meta` import settings into the export manifest

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
