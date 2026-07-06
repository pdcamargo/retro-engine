import type { Handle } from '@retro-engine/assets';

import type { Image } from '../image/image';

/**
 * Internal: one batch the text prepare pass emits — a contiguous slice of the
 * per-frame glyph instance buffer destined for a single instanced draw, all
 * glyphs sharing one font atlas.
 *
 * The queue system turns each batch into one `PhaseItem2d` whose `draw` closure
 * binds the atlas, the instance-buffer slice, and records
 * `drawIndexed(6, count, 0, 0, firstInstance)`. Text is always alpha-blended, so
 * every batch routes to the transparent 2D phase.
 *
 * @internal
 */
export interface TextBatch {
  /** The font atlas image every glyph in this batch samples. */
  readonly atlas: Handle<Image>;
  /** Index of the first glyph in this batch within the per-frame instance buffer. */
  readonly firstInstance: number;
  /** Number of glyph quads in this batch. */
  readonly count: number;
  /** World-space Z of the batch's source entity, for back-to-front sorting. */
  readonly worldZ: number;
}

/**
 * Render-world resource holding the per-frame list of {@link TextBatch}es.
 * Populated by the text plugin's prepare system; consumed by its queue system.
 * Cleared at the start of every prepare pass.
 *
 * @internal
 */
export class TextPreparedBatches {
  batches: TextBatch[] = [];
}
