import type { Query as QueryHandle } from '@retro-engine/ecs';
import type { App, Font, Fonts, Handle, Image, RenderImages, TextLayoutOptions } from '@retro-engine/engine';
import type { TextureFormat } from '@retro-engine/renderer-core';

import { ComputedLayout, UiNode } from '../ui-node';
import type { UiViewport } from '../ui-plugin';
import { UiText } from '../ui-text';

import { packUiGlyph, UI_GLYPH_FLOAT_COUNT } from './ui-glyph-instance';
import { packUiColor } from './ui-instance';
import { computeClipRect } from './ui-prepare';
import { UiTextPipeline } from './ui-text-pipeline';

export type UiTextQuery = QueryHandle<readonly [typeof UiNode, typeof ComputedLayout, typeof UiText]>;

/** One screen-space glyph rect + atlas UV + fill, awaiting clip-space packing. */
interface GlyphItem {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly u0: number;
  readonly v0: number;
  readonly u1: number;
  readonly v1: number;
  readonly unitRangeX: number;
  readonly unitRangeY: number;
  readonly color: number;
}

const layoutOptionsFor = (text: UiText, maxWidth: number): TextLayoutOptions => ({
  fontSize: text.fontSize,
  letterSpacing: text.letterSpacing,
  ...(text.lineHeight !== undefined ? { lineHeight: text.lineHeight } : {}),
  ...(maxWidth > 0 ? { maxWidth } : {}),
});

/**
 * Prepare pass for in-UI text: lay out each {@link UiText} node's string within
 * its node's content box, place the glyphs in screen space, map them to clip
 * space, and pack them into the text pipeline's instance buffer grouped by font
 * atlas (one draw batch per atlas). Skips a node whose font or atlas is not yet
 * loaded (picked up a later frame) and no-ops when there is no surface.
 */
export const prepareUiText = (
  app: App,
  nodes: UiTextQuery,
  viewport: UiViewport,
  fonts: Fonts,
  renderImages: RenderImages,
  pipeline: UiTextPipeline,
  targetFormat: TextureFormat,
  defaultFont?: Handle<Font>,
): void => {
  pipeline.count = 0;
  pipeline.batches.length = 0;
  const surface = app.getSurface();
  if (surface === undefined) return;

  const groups = new Map<number, { atlas: Handle<Image>; items: GlyphItem[] }>();
  let total = 0;

  for (const row of nodes.entries()) {
    const node = row[1] as UiNode;
    const layout = row[2] as ComputedLayout;
    const text = row[3] as UiText;
    const handle = text.font ?? defaultFont;
    if (text.text.length === 0 || handle === undefined) continue;
    const font: Font | undefined = fonts.get(handle);
    if (font === undefined) continue;
    if (renderImages.get(font.atlas) === undefined) continue;

    const pad = node.style.padding;
    const contentX = layout.x + pad.left;
    const contentY = layout.y + pad.top;
    const shaped = font.layout(text.text, layoutOptionsFor(text, layout.contentWidth));
    if (shaped.glyphs.length === 0) continue;

    const unitRangeX = font.data.distanceRange / font.data.atlasWidth;
    const unitRangeY = font.data.distanceRange / font.data.atlasHeight;
    const color = packUiColor(text.color[0] as number, text.color[1] as number, text.color[2] as number, text.color[3] as number);

    let group = groups.get(font.atlas.index);
    if (group === undefined) {
      group = { atlas: font.atlas, items: [] };
      groups.set(font.atlas.index, group);
    }
    for (const g of shaped.glyphs) {
      group.items.push({
        x0: contentX + g.x,
        y0: contentY + g.y,
        x1: contentX + g.x + g.width,
        y1: contentY + g.y + g.height,
        u0: g.u0,
        v0: g.v0,
        u1: g.u1,
        v1: g.v1,
        unitRangeX,
        unitRangeY,
        color,
      });
      total += 1;
    }
  }

  if (total === 0) return;

  const renderer = app.renderer;
  pipeline.ensureInitialised(renderer, targetFormat);
  pipeline.ensureCapacity(renderer, total);

  const f32 = pipeline.scratchF32;
  const u32 = pipeline.scratchU32;
  const vw = viewport.width;
  const vh = viewport.height;
  let instance = 0;
  let cursor = 0;
  for (const group of groups.values()) {
    const firstInstance = instance;
    for (const item of group.items) {
      const clip = computeClipRect(item.x0, item.y0, item.x1 - item.x0, item.y1 - item.y0, vw, vh);
      packUiGlyph(
        clip.left,
        clip.top,
        clip.right,
        clip.bottom,
        item.u0,
        item.v0,
        item.u1,
        item.v1,
        item.unitRangeX,
        item.unitRangeY,
        item.color,
        f32,
        u32,
        cursor,
      );
      cursor += UI_GLYPH_FLOAT_COUNT;
      instance += 1;
    }
    pipeline.batches.push({ atlas: group.atlas, firstInstance, count: group.items.length });
  }

  pipeline.count = total;
  if (pipeline.instanceBuffer !== undefined) {
    renderer.writeBuffer(pipeline.instanceBuffer, 0, f32.subarray(0, cursor) as unknown as BufferSource);
  }
};
