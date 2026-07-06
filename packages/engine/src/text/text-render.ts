import type { Query as QueryHandle } from '@retro-engine/ecs';
import type { Handle } from '@retro-engine/assets';
import type { RenderPassEncoder } from '@retro-engine/renderer-core';

import { SortedCameras } from '../camera/sorted-cameras';
import type { Image } from '../image/image';
import { RenderImages } from '../image/image-plugin';
import type { App, RenderContext } from '../index';
import { Core2dLabel } from '../render-graph/core-2d';
import type { PhaseItem2d } from '../render-graph/phase-2d';
import { ViewPhases2d } from '../render-graph/phase-2d';
import { GlobalTransform } from '../transform';
import { ViewVisibility } from '../visibility/visibility';

import type { Font } from './font-asset';
import { Fonts } from './fonts';
import type { TextBatch } from './text-batch';
import { TextPreparedBatches } from './text-batch';
import {
  packColor,
  packGlyphInstance,
  TEXT_INSTANCE_FLOAT_COUNT,
} from './text-glyph-instance';
import { TextInstanceBuffer } from './text-instance-buffer';
import { layoutText, type PositionedGlyph, type TextLayoutOptions } from './text-layout';
import { TextPipeline } from './text-pipeline';
import { Text2d } from './text2d';

export type TextQuery = QueryHandle<
  readonly [typeof Text2d, typeof GlobalTransform, typeof ViewVisibility]
>;

/** One visible text entity, laid out and ready to pack into the instance buffer. */
interface PreparedText {
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
  readonly worldZ: number;
}

const layoutOptionsFor = (text: Text2d): TextLayoutOptions => ({
  fontSize: text.fontSize,
  align: text.align,
  letterSpacing: text.letterSpacing,
  ...(text.lineHeight !== undefined ? { lineHeight: text.lineHeight } : {}),
  ...(text.maxWidth !== undefined ? { maxWidth: text.maxWidth } : {}),
});

/**
 * Prepare pass: lay out every visible {@link Text2d}, pack its glyph quads into
 * the shared instance buffer, and emit one {@link TextBatch} per entity. A text
 * entity is skipped (picked up a later frame) when its font is not loaded or its
 * atlas texture has not been uploaded yet. One batch per entity keeps each
 * entity's transparent draw independently depth-sorted by the 2D phase.
 */
export const prepareText = (
  app: App,
  texts: TextQuery,
  fonts: Fonts,
  renderImages: RenderImages,
  instanceBuffer: TextInstanceBuffer,
  prepared: TextPreparedBatches,
): void => {
  const entries: PreparedText[] = [];
  let totalGlyphs = 0;

  for (const row of texts.entries()) {
    const text = row[1] as Text2d;
    const gt = row[2] as GlobalTransform;
    const vis = row[3] as ViewVisibility;
    if (!vis.visible) continue;
    if (text.font === undefined || text.text.length === 0) continue;
    const font: Font | undefined = fonts.get(text.font);
    if (font === undefined) continue;
    if (renderImages.get(font.atlas) === undefined) continue;

    const layout = layoutText(font.data, text.text, layoutOptionsFor(text));
    if (layout.glyphs.length === 0) continue;

    entries.push({
      glyphs: layout.glyphs,
      width: layout.width,
      height: layout.height,
      anchorX: text.anchor[0] as number,
      anchorY: text.anchor[1] as number,
      gtMatrix: gt.matrix as Float32Array,
      unitRangeX: font.data.distanceRange / font.data.atlasWidth,
      unitRangeY: font.data.distanceRange / font.data.atlasHeight,
      packedColor: packColor(
        text.color[0] as number,
        text.color[1] as number,
        text.color[2] as number,
        text.color[3] as number,
      ),
      atlas: font.atlas,
      worldZ: gt.matrix[14] as number,
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
    const block = {
      width: entry.width,
      height: entry.height,
      anchorX: entry.anchorX,
      anchorY: entry.anchorY,
    };
    for (const glyph of entry.glyphs) {
      packGlyphInstance(
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
      floatCursor += TEXT_INSTANCE_FLOAT_COUNT;
      instanceCursor += 1;
    }
    prepared.batches.push({
      atlas: entry.atlas,
      firstInstance,
      count: entry.glyphs.length,
      worldZ: entry.worldZ,
    } satisfies TextBatch);
  }

  instanceBuffer.count = instanceCursor;
  if (floatCursor > 0 && instanceBuffer.buffer !== undefined) {
    const view = f32.subarray(0, floatCursor);
    app.renderer.writeBuffer(instanceBuffer.buffer, 0, view as unknown as BufferSource);
  }
};

/**
 * Queue pass: turn each prepared {@link TextBatch} into one transparent
 * {@link PhaseItem2d} per active 2D camera. Text is always alpha-blended, so
 * every item routes to the transparent phase, depth-sorted back-to-front.
 */
export const queueText = (
  app: App,
  cameras: SortedCameras,
  renderImages: RenderImages,
  pipeline: TextPipeline,
  instanceBuffer: TextInstanceBuffer,
  prepared: TextPreparedBatches,
  phases: ViewPhases2d,
): void => {
  if (prepared.batches.length === 0) return;
  if (!pipeline.ensureInitialised(app)) return;
  const quadVertex = pipeline.quadVertexBuffer;
  const quadIndex = pipeline.quadIndexBuffer;
  const specialized = pipeline.specialized;
  const instanceBufferGpu = instanceBuffer.buffer;
  if (
    quadVertex === undefined ||
    quadIndex === undefined ||
    specialized === undefined ||
    instanceBufferGpu === undefined
  ) {
    return;
  }

  for (const view of cameras.views) {
    if (view.subGraph !== Core2dLabel) continue;
    const v = view.viewMatrix as Float32Array;
    for (const batch of prepared.batches) {
      const bindGroup = pipeline.bindGroupFor(batch.atlas, renderImages, app.renderer);
      if (bindGroup === undefined) continue;
      const renderPipeline = specialized.get({
        key: {
          surfaceFormat: view.mainColorTarget.format,
          msaaSamples: 1,
          hdr: view.hdr,
        },
      });
      const sortDepth = (v[10] as number) * batch.worldZ + (v[14] as number);
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
      } satisfies PhaseItem2d);
    }
  }
};
