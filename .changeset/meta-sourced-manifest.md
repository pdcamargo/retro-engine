---
'@retro-engine/engine': minor
---

feat(engine): `.meta`-sourced manifest, no committed manifest or project.json (ADR-0089)

`serializeProject` no longer writes a committed `assets.manifest.json` or a `project.json`
index. Asset identity is the committed `.meta` sidecar (now `{ version, guid, kind }`), and
the GUID→location manifest is rebuilt from sidecars on load via the new `scanMetaManifest`,
adopted through the existing `AssetServer.setManifest`. `SavedProject` now exposes
`scenes: { location, guid }[]` and a derived (not written) `manifest`.

Removed from the public surface: `PROJECT_FORMAT_VERSION`, `ProjectDocFile`, and
`serializeProject`'s `manifestLocation`/`projectDocLocation` options. The human-authored
project descriptor (`project.retroengine`, TOML) is owned by the scaffolder/studio, not by
`serializeProject`.
