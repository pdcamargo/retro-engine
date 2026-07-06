import type { Query as QueryHandle } from '@retro-engine/ecs';
import type { Handle } from '@retro-engine/assets';
import type { RenderPassEncoder } from '@retro-engine/renderer-core';

import { SortedCameras } from '../camera/sorted-cameras';
import type { Image } from '../image/image';
import { RenderImages } from '../image/image-plugin';
import type { App, RenderContext } from '../index';
import { Core3dLabel } from '../render-graph/core-3d';
import type { PhaseItem3d } from '../render-graph/phase-3d';
import { ViewPhases3d } from '../render-graph/phase-3d';
import { GlobalTransform } from '../transform';
import { ViewVisibility } from '../visibility/visibility';

import type { Font } from './font-asset';
import { Fonts } from './fonts';
import { Text3dPreparedBatches } from './text-batch-3d';
import { packColor } from './text-glyph-instance';
import { packGlyphInstance3d, TEXT3D_INSTANCE_FLOAT_COUNT } from './text-glyph-instance-3d';
import { Text3dInstanceBuffer } from './text-instance-buffer-3d';
import { layoutText, type PositionedGlyph, type TextLayoutOptions } from './text-layout';
import { Text3dPipeline } from './text-pipeline-3d';
import { Text } from './text3d';

export type Text3dQuery = QueryHandle<
  readonly [typeof Text, typeof GlobalTransform, typeof ViewVisibility]
>;

interface PreparedText3d {
  readonly glyphs: PositionedGlyph[];
  readonly width: number;
  readonly height: number;
  readonly anchorX: number;
  readonly anchorY: number;
  readonly gtMatrix: Float32Array;
  readonly unitRangeX: number;
  readonly unitRangeY: number;
  readonly packedColor: number;
  readonly atlas: Handle<Image>;
  readonly worldX: number;
  readonly worldY: number;
  readonly worldZ: number;
}

const layoutOptionsFor = (text: Text): TextLayoutOptions => ({
  fontSize: text.fontSize,
  align: text.align,
  letterSpacing: text.letterSpacing,
  ...(text.lineHeight !== undefined ? { lineHeight: text.lineHeight } : {}),
  ...(text.maxWidth !== undefined ? { maxWidth: text.maxWidth } : {}),
});

/**
 * Prepare pass: lay out every visible {@link Text}, pack its glyph quads into the
 * shared 3D instance buffer (world-space, via `packGlyphInstance3d`), and emit one
 * {@link import('./text-batch-3d').Text3dBatch} per entity. Skips text with no
 * loaded font / uploaded atlas (retried a later frame). One batch per entity keeps
 * each entity's transparent draw independently depth-sorted by the 3D phase.
 */
export const prepareText3d = (
  app: App,
  texts: Text3dQuery,
  fonts: Fonts,
  renderImages: RenderImages,
  instanceBuffer: Text3dInstanceBuffer,
  prepared: Text3dPreparedBatches,
): void => {
  const entries: PreparedText3d[] = [];
  let totalGlyphs = 0;

  for (const row of texts.entries()) {
    const text = row[1] as Text;
    const gt = row[2] as GlobalTransform;
    const vis = row[3] as ViewVisibility;
    if (!vis.visible) continue;
    if (text.font === undefined || text.text.length === 0) continue;
    const font: Font | undefined = fonts.get(text.font);
    if (font === undefined) continue;
    if (renderImages.get(font.atlas) === undefined) continue;

    const layout = layoutText(font.data, text.text, layoutOptionsFor(text));
    if (layout.glyphs.length === 0) continue;

    const m = gt.matrix as Float32Array;
    entries.push({
      glyphs: layout.glyphs,
      width: layout.width,
      height: layout.height,
      anchorX: text.anchor[0] as number,
      anchorY: text.anchor[1] as number,
      gtMatrix: m,
      unitRangeX: font.data.distanceRange / font.data.atlasWidth,
      unitRangeY: font.data.distanceRange / font.data.atlasHeight,
      packedColor: packColor(
        text.color[0] as number,
        text.color[1] as number,
        text.color[2] as number,
        text.color[3] as number,
      ),
      atlas: font.atlas,
      worldX: m[12] as number,
      worldY: m[13] as number,
      worldZ: m[14] as number,
    });
    totalGlyphs += layout.glyphs.length;
  }

  if (totalGlyphs === 0) return;
  instanceBuffer.ensureCapacity(app.renderer, totalGlyphs);

  const f32 = instanceBuffer.scratchF32;
  const u32 = instanceBuffer.scratchU32;
  let floatCursor = 0;
  let instanceCursor = 0;
  for (const entry of entries) {
    const firstInstance = instanceCursor;
    const block = { width: entry.width, height: entry.height, anchorX: entry.anchorX, anchorY: entry.anchorY };
    for (const glyph of entry.glyphs) {
      packGlyphInstance3d(
        glyph,
        block,
        entry.gtMatrix,
        entry.unitRangeX,
        entry.unitRangeY,
        entry.packedColor,
        f32,
        u32,
        floatCursor,
      );
      floatCursor += TEXT3D_INSTANCE_FLOAT_COUNT;
      instanceCursor += 1;
    }
    prepared.batches.push({
      atlas: entry.atlas,
      firstInstance,
      count: entry.glyphs.length,
      worldX: entry.worldX,
      worldY: entry.worldY,
      worldZ: entry.worldZ,
    });
  }

  instanceBuffer.count = instanceCursor;
  if (floatCursor > 0 && instanceBuffer.buffer !== undefined) {
    const view = f32.subarray(0, floatCursor);
    app.renderer.writeBuffer(instanceBuffer.buffer, 0, view as unknown as BufferSource);
  }
};

/**
 * Queue pass: turn each prepared {@link import('./text-batch-3d').Text3dBatch} into
 * one transparent {@link PhaseItem3d} per active 3D camera, depth-sorted
 * back-to-front by the entity's view-space depth. The Core3d transparent pass
 * binds the view (`@group(0)`) + depth attachment; each draw sets the pipeline,
 * the atlas (`@group(1)`), the instance slice, and records the instanced draw.
 */
export const queueText3d = (
  app: App,
  cameras: SortedCameras,
  renderImages: RenderImages,
  pipeline: Text3dPipeline,
  instanceBuffer: Text3dInstanceBuffer,
  prepared: Text3dPreparedBatches,
  phases: ViewPhases3d,
): void => {
  if (prepared.batches.length === 0) return;
  if (!pipeline.ensureInitialised(app)) return;
  const quadVertex = pipeline.quadVertexBuffer;
  const quadIndex = pipeline.quadIndexBuffer;
  const specialized = pipeline.specialized;
  const instanceBufferGpu = instanceBuffer.buffer;
  if (quadVertex === undefined || quadIndex === undefined || specialized === undefined || instanceBufferGpu === undefined) {
    return;
  }

  for (const view of cameras.views) {
    if (view.subGraph !== Core3dLabel) continue;
    const v = view.viewMatrix as Float32Array;
    for (const batch of prepared.batches) {
      const bindGroup = pipeline.bindGroupFor(batch.atlas, renderImages, app.renderer);
      if (bindGroup === undefined) continue;
      const renderPipeline = specialized.get({
        key: {
          surfaceFormat: view.mainColorTarget.format,
          msaaSamples: 1,
          hdr: view.hdr,
          depthFormat: view.depth?.format,
        },
      });
      // View-space z of the entity origin (row 2 of the column-major view matrix).
      const sortDepth =
        (v[2] as number) * batch.worldX +
        (v[6] as number) * batch.worldY +
        (v[10] as number) * batch.worldZ +
        (v[14] as number);
      const firstInstance = batch.firstInstance;
      const count = batch.count;
      const draw = (pass: RenderPassEncoder, _ctx: RenderContext): void => {
        pass.setPipeline(renderPipeline);
        pass.setBindGroup(1, bindGroup);
        pass.setVertexBuffer(0, quadVertex);
        pass.setVertexBuffer(1, instanceBufferGpu);
        pass.setIndexBuffer(quadIndex, 'uint16');
        pass.drawIndexed(6, count, 0, 0, firstInstance);
      };
      phases.pushTransparent(view.sourceEntity, {
        sourceEntity: view.sourceEntity,
        sortDepth,
        draw,
      } satisfies PhaseItem3d);
    }
  }
};
