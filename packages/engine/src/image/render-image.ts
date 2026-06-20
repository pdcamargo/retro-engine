import type { Sampler, Texture, TextureView } from '@retro-engine/renderer-core';

import type { ImageDimension } from './image';

/**
 * GPU-side companion of an {@link Image}. Built once per `Added`/`Modified`
 * asset event by `ImagePlugin`'s prepare system and stored in
 * `RenderImages`. Bind-group walkers reading a texture binding pull `.view`;
 * walkers reading a sampler binding pull `.sampler`. `.texture` is retained
 * for lifetime management — `ImagePlugin` destroys it when the source asset
 * is removed or modified.
 */
export interface RenderImage {
  readonly texture: Texture;
  readonly view: TextureView;
  readonly sampler: Sampler;
  /** Source image dimension, so consumers can tell an equirect (`'2d'`) from a `'cube'`. */
  readonly dimension: ImageDimension;
}
