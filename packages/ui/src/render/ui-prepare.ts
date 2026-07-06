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

const hasVisibleBackground = (node: UiNode): boolean => {
  const bg = node.style.backgroundColor;
  return bg !== undefined && (bg[3] as number) > 0;
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

  // Collect visible background nodes, then paint in depth-first `order` so a
  // (possibly translucent) parent draws behind its children.
  const visible: { layout: ComputedLayout; color: number }[] = [];
  for (const row of nodes.entries()) {
    const node = row[1] as UiNode;
    if (!hasVisibleBackground(node)) continue;
    const bg = node.style.backgroundColor!;
    visible.push({
      layout: row[2] as ComputedLayout,
      color: packUiColor(bg[0] as number, bg[1] as number, bg[2] as number, bg[3] as number),
    });
  }
  if (visible.length === 0) return;
  visible.sort((a, b) => a.layout.order - b.layout.order);

  const renderer = app.renderer;
  pipeline.ensureInitialised(renderer, surface.format);
  pipeline.ensureCapacity(renderer, visible.length);

  const f32 = pipeline.scratchF32;
  const u32 = pipeline.scratchU32;
  const vw = viewport.width;
  const vh = viewport.height;
  let cursor = 0;
  for (const { layout, color } of visible) {
    const clip = computeClipRect(layout.x, layout.y, layout.width, layout.height, vw, vh);
    packUiQuad(clip.left, clip.top, clip.right, clip.bottom, color, f32, u32, cursor);
    cursor += UI_INSTANCE_FLOAT_COUNT;
  }

  pipeline.count = visible.length;
  if (pipeline.instanceBuffer !== undefined) {
    renderer.writeBuffer(pipeline.instanceBuffer, 0, f32.subarray(0, cursor) as unknown as BufferSource);
  }
};
