import type { Query as QueryHandle } from '@retro-engine/ecs';
import type { App } from '@retro-engine/engine';

import { ComputedLayout, UiNode } from '../ui-node';
import type { UiViewport } from '../ui-plugin';

import { packUiColor, packUiQuad, UI_INSTANCE_FLOAT_COUNT } from './ui-instance';
import { UiPipeline } from './ui-pipeline';

/** A clip-space rect: `(left, top, right, bottom)`, top near +1 and bottom near −1. */
export interface ClipRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/**
 * Map a box in logical pixels (top-left origin, y-down) within a viewport of
 * `viewportW × viewportH` to WebGPU clip space (`x,y ∈ [-1, 1]`, y up). Pure.
 */
export const computeClipRect = (
  x: number,
  y: number,
  w: number,
  h: number,
  viewportW: number,
  viewportH: number,
): ClipRect => ({
  left: (2 * x) / viewportW - 1,
  top: 1 - (2 * y) / viewportH,
  right: (2 * (x + w)) / viewportW - 1,
  bottom: 1 - (2 * (y + h)) / viewportH,
});

export type UiQuadQuery = QueryHandle<readonly [typeof UiNode, typeof ComputedLayout]>;

/** An axis-aligned rect in screen-space logical pixels. */
export interface EdgeRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Four-sided border widths in logical pixels. */
export interface BorderEdges {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/**
 * The (up to four) border-edge rects for a node's border box `(x, y, w, h)`,
 * drawn *inside* the box per side width (CSS `border-box`). The left/right edges
 * are inset by the top/bottom widths so corners are not double-covered. Only
 * sides with a positive width are returned; degenerate (≤0) spans are dropped.
 */
export const borderEdgeRects = (
  x: number,
  y: number,
  w: number,
  h: number,
  edges: BorderEdges,
): EdgeRect[] => {
  const rects: EdgeRect[] = [];
  const midH = h - edges.top - edges.bottom;
  if (edges.top > 0) rects.push({ x, y, w, h: edges.top });
  if (edges.bottom > 0) rects.push({ x, y: y + h - edges.bottom, w, h: edges.bottom });
  if (edges.left > 0 && midH > 0) rects.push({ x, y: y + edges.top, w: edges.left, h: midH });
  if (edges.right > 0 && midH > 0) {
    rects.push({ x: x + w - edges.right, y: y + edges.top, w: edges.right, h: midH });
  }
  return rects;
};

/**
 * Prepare pass: pack every `UiNode` with a visible `backgroundColor` into the
 * pipeline's instance buffer as a clip-space quad. Skips entirely when there is
 * no surface yet (headless) or no visible background. Allocation-free (two query
 * passes: count, then pack).
 */
export const prepareUiQuads = (
  app: App,
  nodes: UiQuadQuery,
  viewport: UiViewport,
  pipeline: UiPipeline,
): void => {
  pipeline.count = 0;
  const surface = app.getSurface();
  if (surface === undefined) return;

  // Collect a node's background quad then its border-edge quads (same `order`),
  // then paint everything in depth-first `order` — a (possibly translucent)
  // parent draws behind its children, and each node's border draws over its own
  // background (stable sort keeps the background first).
  const quads: { order: number; x: number; y: number; w: number; h: number; color: number }[] = [];
  for (const row of nodes.entries()) {
    const style = (row[1] as UiNode).style;
    const layout = row[2] as ComputedLayout;
    const bg = style.backgroundColor;
    if (bg !== undefined && (bg[3] as number) > 0) {
      quads.push({
        order: layout.order,
        x: layout.x,
        y: layout.y,
        w: layout.width,
        h: layout.height,
        color: packUiColor(bg[0] as number, bg[1] as number, bg[2] as number, bg[3] as number),
      });
    }
    const bc = style.borderColor;
    if (bc !== undefined && (bc[3] as number) > 0) {
      const bw = style.borderWidth;
      if (bw.left > 0 || bw.right > 0 || bw.top > 0 || bw.bottom > 0) {
        const color = packUiColor(bc[0] as number, bc[1] as number, bc[2] as number, bc[3] as number);
        for (const r of borderEdgeRects(layout.x, layout.y, layout.width, layout.height, bw)) {
          quads.push({ order: layout.order, x: r.x, y: r.y, w: r.w, h: r.h, color });
        }
      }
    }
  }
  if (quads.length === 0) return;
  quads.sort((a, b) => a.order - b.order);

  const renderer = app.renderer;
  pipeline.ensureInitialised(renderer, surface.format);
  pipeline.ensureCapacity(renderer, quads.length);

  const f32 = pipeline.scratchF32;
  const u32 = pipeline.scratchU32;
  const vw = viewport.width;
  const vh = viewport.height;
  let cursor = 0;
  for (const q of quads) {
    const clip = computeClipRect(q.x, q.y, q.w, q.h, vw, vh);
    packUiQuad(clip.left, clip.top, clip.right, clip.bottom, q.color, f32, u32, cursor);
    cursor += UI_INSTANCE_FLOAT_COUNT;
  }

  pipeline.count = quads.length;
  if (pipeline.instanceBuffer !== undefined) {
    renderer.writeBuffer(pipeline.instanceBuffer, 0, f32.subarray(0, cursor) as unknown as BufferSource);
  }
};
