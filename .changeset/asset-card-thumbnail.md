---
'@retro-engine/editor-sdk': minor
---

feat(editor-sdk): asset-card thumbnails

Per ADR-0101, the asset browser can now paint a generated preview texture in a
tile instead of the procedural placeholder.

- `AssetCardOptions.thumbnail?: ImTextureRef` — an optional preview master drawn
  in the tile (over a checkerboard, so transparent images read correctly),
  sampled to whatever tile size is shown. Absent → the existing procedural
  preview for the asset type. Existing callers are unaffected.
- `Draw.image(ref, min, max)` — paint a registered texture into a draw-list
  rectangle in screen space.
