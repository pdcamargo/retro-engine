import type { Handle } from '@retro-engine/assets';

import type { Image } from '../image/image';

/**
 * One world-space text batch the 3D prepare pass emits — a contiguous slice of
 * the per-frame 3D glyph instance buffer for a single instanced draw, all glyphs
 * sharing one font atlas. The queue system turns each into one `PhaseItem3d` in
 * the Core3d transparent phase, sorted back-to-front by the source entity's
 * view-space depth (computed in queue from `worldX/Y/Z`).
 *
 * @internal
 */
export interface Text3dBatch {
  /** The font atlas image every glyph in this batch samples. */
  readonly atlas: Handle<Image>;
  /** Index of the first glyph within the per-frame 3D instance buffer. */
  readonly firstInstance: number;
  /** Number of glyph quads in this batch. */
  readonly count: number;
  /** World-space translation of the source entity (for view-space depth sort). */
  readonly worldX: number;
  readonly worldY: number;
  readonly worldZ: number;
}

/**
 * Render-world resource holding the per-frame list of {@link Text3dBatch}es.
 * Populated by the 3D text prepare system; consumed by its queue system; cleared
 * at the start of every prepare pass.
 *
 * @internal
 */
export class Text3dPreparedBatches {
  batches: Text3dBatch[] = [];
}
