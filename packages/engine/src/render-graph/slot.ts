import type { Buffer, Sampler, TextureView } from '@retro-engine/renderer-core';

/**
 * Type tag for a {@link RenderGraph} slot.
 *
 * Slots are the connection points between nodes. A node declares typed inputs
 * and outputs; edges connect an output of one node to an input of another, and
 * the graph type-checks edges at freeze time.
 *
 * Only {@link Entity} is consumed by day-1 nodes — it carries the per-camera
 * view entity into a sub-graph from the {@link CameraDriverNode}. The
 * {@link TextureView}, {@link Buffer}, and {@link Sampler} variants are
 * declared now so the surface is stable, but no built-in node produces or
 * consumes them yet; their first real consumers land with the transient
 * resource allocator (roadmap §5.5) and post-processing nodes (roadmap §12).
 */
export const SlotType = {
  /** A render-world entity ID (typically a camera view entity). */
  Entity: 'entity',
  /** A GPU texture view. Reserved for §5.5 transient resources. */
  TextureView: 'textureView',
  /** A GPU buffer. Reserved for §5.5 transient resources. */
  Buffer: 'buffer',
  /** A GPU sampler. Reserved for §5.5 transient resources. */
  Sampler: 'sampler',
} as const;

/** One of the {@link SlotType} values. */
export type SlotType = (typeof SlotType)[keyof typeof SlotType];

/**
 * Metadata describing one input or output slot of a {@link Node}. Names are
 * scoped to the declaring node; two different nodes may both expose a
 * `'view'` slot without collision.
 */
export interface SlotInfo {
  readonly name: string;
  readonly type: SlotType;
}

/**
 * The runtime value carried through a slot. The discriminant matches
 * {@link SlotType}; the underlying handle types come from
 * `@retro-engine/renderer-core`.
 */
export type SlotValue =
  | { readonly type: typeof SlotType.Entity; readonly value: number }
  | { readonly type: typeof SlotType.TextureView; readonly value: TextureView }
  | { readonly type: typeof SlotType.Buffer; readonly value: Buffer }
  | { readonly type: typeof SlotType.Sampler; readonly value: Sampler };

/**
 * Map from slot name to its current value, supplied to a node via
 * {@link NodeRunContext.inputs}. Empty on day 1 for every built-in node —
 * inter-node data flow lands with §5.5.
 */
export type SlotValues = ReadonlyMap<string, SlotValue>;

/** Convenience: an empty {@link SlotValues} map. Reuse this to avoid allocating per node invocation. */
export const EMPTY_SLOT_VALUES: SlotValues = new Map();
