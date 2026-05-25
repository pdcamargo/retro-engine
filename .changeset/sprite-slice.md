---
'@retro-engine/engine': minor
---

feat(engine): TextureSlicer — 9-slice sprites via SpriteImageMode

Phase 8.5 adds 9-slice rendering on top of the existing sprite hot path. Per ADR-0034. A new optional `imageMode` field on `Sprite` toggles the renderer between the historical single-quad path (default) and a new 9-quad path: four corner quads stay at the border's pixel size in destination units while the four edges and centre stretch to fill `customSize`. Drop-in stretchable UI panels — dialog boxes, health bars, scroll backgrounds — without re-authoring images per size.

The slicer composes with the rest of the 2D data path automatically. An atlassed sprite can be sliced (the border carves inside `sprite.rect`'s per-frame UV sub-rect, not the full image). An animated sprite can be sliced (the animator ticks `atlas.index` → atlas-sync writes `sprite.rect` → the slice packer reads the new rect). A parented sprite can be sliced (the per-instance affine basis handles non-uniform scale and rotation correctly across all nine quads). No new plugins, no new resources — `SpritePlugin`'s system registration is unchanged.

**New public surface:**

- `BorderRect` — value class. `{ left, right, top, bottom }` in **source-image pixels** (Y-up convention matching `SpriteAnchor` — `top` = the higher-Y edge of the source rectangle). Four-arg constructor for asymmetric borders; static `BorderRect.all(px)` factory for symmetric panels.
- `TextureSlicer` — data class describing a 9-slice carving. Options-bag constructor: `{ border: BorderRect; centerScaleMode?: SliceScaleMode; sidesScaleMode?: SliceScaleMode; maxCornerScale?: number }`. Both scale modes default to `'stretch'`. Only `'stretch'` ships in this phase; `'tile'` and `maxCornerScale` enforcement are forward-compat seams documented under "Not yet done" in ADR-0034.
- `TextureSlicerOptions` — input shape for the constructor.
- `SliceScaleMode` — `'stretch'` (single-variant union; expands when tile mode lands).
- `SpriteImageMode` — discriminated union `{ kind: 'auto' } | { kind: 'sliced'; slicer: TextureSlicer }`. Stored on `Sprite` as the new optional `imageMode` field.

**`Sprite` constructor delta:**

- `SpriteOptions.imageMode?: SpriteImageMode` — new optional field. Default (`undefined`) renders as a single quad — every existing call site is unaffected. Pass `{ kind: 'sliced', slicer }` to opt into 9-slice rendering:

  ```ts
  cmd.spawn(
    new Sprite({
      image: panelImage,
      customSize: vec2.create(320, 160),
      imageMode: {
        kind: 'sliced',
        slicer: new TextureSlicer({ border: BorderRect.all(8) }),
      },
    }),
    new Transform(...),
  );
  ```

**Behaviour changes (non-breaking):**

- `packSpriteInstance` is now a router. For sprites without `imageMode` (or with `{ kind: 'auto' }`), the packed output is byte-identical to the previous behaviour. For `{ kind: 'sliced', slicer }`, the function emits nine packed instances in fixed `BL → BM → BR → ML → MM → MR → TL → TM → TR` order and returns `9 × SPRITE_INSTANCE_FLOAT_COUNT`. Callers that step a cursor via the return value (the standard pattern) are unaffected.
- The sprite prepare loop's instance-count is now `consumed / SPRITE_INSTANCE_FLOAT_COUNT` per entity instead of `+ 1`. The instance buffer's growth target accounts for sliced entities contributing 9 each. Batches still key on `(image, alphaBucket)` and a sliced sprite contributes 9 contiguous instances to its batch.
