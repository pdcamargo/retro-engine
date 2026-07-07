---
'@retro-engine/engine': minor
---

feat(engine): TextureAtlasLayout.fromRects (manual sprite slicing)

`TextureAtlasLayout.fromRects({ size, rects })` builds an atlas layout from
hand-placed pixel rects — the Unity "multiple" sprite mode for irregularly
arranged sprite sheets, the manual counterpart to `fromGrid`:

```ts
TextureAtlasLayout.fromRects({
  size: vec2.create(100, 50),
  rects: [
    { x: 0, y: 0, width: 40, height: 50 },
    { x: 50, y: 10, width: 50, height: 30 },
  ],
});
```

Each rect is normalised to UV against `size`, order-preserving (so
`TextureAtlas.index` maps to `rects[index]`). Throws on a non-positive size or
rect dimension. Fills the manual-rect slicing gap of sprite definitions;
`TextureAtlasRect` / `TextureAtlasFromRectsOptions` are exported.
