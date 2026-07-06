import type { UiStyle } from './ui-style';

/**
 * Intrinsic content measurement for a leaf node (e.g. text): given the space
 * available on each axis (either may be `Infinity` when unconstrained), return
 * the content's natural size in logical pixels. This is the hook the engine text
 * layer plugs `measureText` into.
 */
export type MeasureFunc = (
  availableWidth: number,
  availableHeight: number,
) => { width: number; height: number };

/**
 * Input tree handed to a {@link LayoutEngine}: a node's resolved {@link UiStyle},
 * its children, an optional intrinsic {@link MeasureFunc} (for leaves with no
 * children, like text), and an opaque {@link key} echoed back on the result so a
 * caller can map results to their source entities.
 */
export interface LayoutNode {
  readonly style: UiStyle;
  readonly children: readonly LayoutNode[];
  readonly measure?: MeasureFunc;
  readonly key?: unknown;
}

/** An axis-aligned box in logical pixels, origin at the parent content-box top-left, y down. */
export interface LayoutRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Computed layout for one node and its subtree. {@link rect} is the node's
 * border box relative to its parent's **border-box** top-left origin (already
 * inset by the parent's padding; the root's rect is at `(0, 0)`). Accumulate
 * ancestor `rect` offsets to get a screen-space position. {@link children} align
 * 1:1 with the input node's children (in the original order).
 */
export interface LayoutResult {
  readonly rect: LayoutRect;
  /** Inner content width (border box minus padding), in pixels. */
  readonly contentWidth: number;
  /** Inner content height (border box minus padding), in pixels. */
  readonly contentHeight: number;
  readonly children: readonly LayoutResult[];
  readonly key?: unknown;
}

/** Available space for the root of a layout pass. */
export interface AvailableSpace {
  readonly width: number;
  readonly height: number;
}

/**
 * Computes absolute-ish box geometry for a UI node tree. Swappable behind this
 * interface so a game can pick flexbox now and (later) CSS grid or a WASM
 * engine without the ECS layout system changing.
 */
export interface LayoutEngine {
  /** Lay out `root` within `available` and return the positioned result tree. */
  compute(root: LayoutNode, available: AvailableSpace): LayoutResult;
}
