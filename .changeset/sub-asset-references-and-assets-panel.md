---
'@retro-engine/assets': minor
'@retro-engine/engine': minor
'@retro-engine/editor-sdk': minor
---

feat: sub-asset references + derived-asset asset browser

Per ADR-0126, gives a container's decoded children (a model's meshes, materials, and animation clips) a persistent, resolvable identity so a saved reference to one survives reload — and surfaces them in the studio's rebuilt asset browser.

**`@retro-engine/assets`** — `subAssetGuid(parent, label)` / `parseSubAssetGuid(guid)`: the composite GUID-URI (`"<parentGuid>#<label>"`) that names a labeled sub-asset deterministically from its container's GUID. A single string, so it serializes and resolves exactly like a top-level GUID.

**`@retro-engine/engine`** — `AssetServer.registerSubAssetStore(prefix, store)` binds a label prefix to the store that holds those sub-assets; `loadByGuid` now resolves a sub-asset reference by reserving the slot and loading the parent so its `addLabeledAsset` fills it (matched by GUID), and `hasGuid` recognizes sub-refs whose container is resolvable. `addLabeledAsset` mints the deterministic sub-GUID when a parent GUID is present. The glTF `AnimationPlugin` registers the `Animation` prefix, so a model's clips are assignable to a `Handle<AnimationClip>` field and round-trip through scene save/load. `subAssetGuid` / `parseSubAssetGuid` are re-exported.

**`@retro-engine/editor-sdk`** — `assetCard` returns `AssetCardResult` (`{ clicked, expandToggled, checkToggled, rightClicked }`) and takes an `onContextMenu` hook anchored to the tile; its error preview uses the triangle-alert glyph and sprites get a dashed cyan crop frame; the fold chip moved to the top-right to clear the type tag. `assetGroup` is generalized from sprite-only to any source file's mixed children: it takes `headerType` (drives the icon/tone) and a `summary` string instead of a sprite count, and draws the inset accent rail.
