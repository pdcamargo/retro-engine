import type { Handle, Image } from '@retro-engine/engine';
import { type Vec4, vec4 } from '@retro-engine/math';

/** Options for {@link UiImage}. */
export interface UiImageOptions {
  /** The image asset to draw. A node with no image draws nothing. */
  readonly image?: Handle<Image>;
  /** Multiplied over the sampled texels (RGBA in `[0, 1]`); default opaque white. */
  readonly tint?: Vec4;
  /** Source UV sub-rect `[u0, v0, u1, v1]` for atlas/sprite regions; default full `0..1`. */
  readonly uv?: readonly [number, number, number, number];
}

/**
 * Draws a textured quad filling a UI node's box — an image / icon / sprite in the
 * UI. The node's {@link import('./ui-node').UiNode} still owns layout (size it via
 * style or flex); this only supplies the texture, tint, and source region. A node
 * may carry both a background color and a `UiImage` (the image draws over the fill).
 */
export class UiImage {
  /** The image asset to draw, or `undefined` to draw nothing. */
  image: Handle<Image> | undefined;
  /** Color multiplied over the sampled texels. */
  tint: Vec4;
  /** Source UV sub-rect `[u0, v0, u1, v1]`. */
  uv: [number, number, number, number];

  constructor(opts: UiImageOptions = {}) {
    this.image = opts.image;
    this.tint = opts.tint ?? vec4.create(1, 1, 1, 1);
    this.uv = opts.uv !== undefined ? [...opts.uv] : [0, 0, 1, 1];
  }
}
