import type { Handle } from '@retro-engine/assets';

import type { TextureAtlasLayout } from './texture-atlas-layout';

/**
 * ECS component pairing a sprite entity with a {@link TextureAtlasLayout}
 * asset and an index into that layout's `textures[]`. Together with the
 * entity's `Sprite.image`, it identifies "which tile of which image to render
 * right now."
 *
 * Spawn alongside a `Sprite`:
 *
 * ```ts
 * cmd.spawn(
 *   new Sprite({ image: tilesheet }),
 *   new TextureAtlas(layout, 0),
 *   new Transform(...),
 * );
 * ```
 *
 * Mutate {@link index} from gameplay code to change frame — e.g. a sprite
 * animator bumps `atlas.index` every N ms. The engine's `atlas-sync` system
 * picks the mutation up (via `Changed<TextureAtlas>` change-detection) and
 * writes `sprite.rect = layout.textures[atlas.index]` in `postUpdate`, so the
 * next frame's sprite-batch prepare pass sees the new UV without any further
 * plumbing.
 *
 * Note: gameplay code that mutates {@link index} in place must call
 * `world.markChanged(entity, TextureAtlas)` afterwards so the change-detection
 * filter in `atlas-sync` fires. The harness pattern matches in-place
 * `Transform` mutations elsewhere in the engine.
 *
 * Out-of-bounds {@link index} (≥ `layout.textures.length`) and unknown
 * {@link layout} handles are silently ignored by `atlas-sync` — the sprite
 * keeps its prior `rect`, so a stale animator does not blank the sprite.
 */
export class TextureAtlas {
  /** Layout asset that carves the source image. */
  layout: Handle<TextureAtlasLayout>;
  /**
   * Which tile of {@link layout} to render this frame. Indexes into
   * `layout.textures[]`; for grid layouts built via
   * `TextureAtlasLayout.fromGrid`, indexing is row-major.
   */
  index: number;

  constructor(layout: Handle<TextureAtlasLayout>, index = 0) {
    this.layout = layout;
    this.index = index;
  }
}
