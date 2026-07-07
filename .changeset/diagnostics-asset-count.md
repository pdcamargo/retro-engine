---
'@retro-engine/engine': minor
---

feat(engine): asset count in diagnostics

`DiagnosticsStore` gains an `assetCount` — the total loaded assets across every
registered `AssetStores` store, refreshed each frame by `DiagnosticsPlugin`
alongside FPS / frame-time / entity count. Distinct stores are counted once even
when bound under several asset-type keys (new `AssetStores.totalAssetCount()`).
`updateDiagnostics` takes an optional `assetCount` argument (omitting it leaves
the field untouched), so existing callers are unaffected.

The remaining piece of the diagnostics item is the on-screen overlay.
