import type { ImTextureRef } from '@mori2003/jsimgui';

import { ASSET_TYPES, type AssetType } from './components-asset';
import { applyItemDnd, type ItemDnd } from './dnd/item-dnd';
import { Draw } from './draw';
import { drawIcon } from './icon-shapes';
import { getActivePalette, srgbU32, toneColors } from './palette';
import { ui } from './ui';
import type { Vec2 } from './units';

/** Height (px) of the asset field, on the design system's `sm` control scale. */
const FIELD_H = 26;

/** Options for {@link Widgets.assetField}. */
export interface AssetFieldOptions {
  /** Assigned asset's display name; `undefined` renders the empty "assign" state. */
  readonly name?: string | undefined;
  /** Assigned asset's type, for the swatch placeholder icon and the type tag. */
  readonly type?: AssetType | undefined;
  /** A generated preview to paint in the swatch; falls back to the type icon. */
  readonly thumbnail?: ImTextureRef | undefined;
  /** The asset type the slot expects (e.g. `Texture`), shown muted while empty. */
  readonly expectsLabel?: string | undefined;
  /** Draw inert (no hover/click) — the field is read-only this frame. */
  readonly readonly?: boolean | undefined;
  /** Drag-and-drop binding (attached to the field's hit-target). */
  readonly dnd?: ItemDnd | undefined;
}

/**
 * An input-like asset slot, à la Unity's object field: a swatch (thumbnail or
 * type icon), the assigned asset's name (or a muted "None" while empty), a type
 * tag, and a target affordance. Returns whether it was clicked — the caller opens
 * its picker in response, keeping assignment decoupled from the click-to-open
 * flow so other triggers (e.g. a future drag-and-drop) can assign the same way.
 */
export const assetField = (id: string, o: AssetFieldOptions): { clicked: boolean } => {
  const p = getActivePalette();
  const dl = Draw.window();
  const w = ui.contentAvail()[0];
  const min = ui.cursorScreenPos();
  const max: Vec2 = [min[0] + w, min[1] + FIELD_H];

  const clicked = ui.invisibleButton(`##af-${id}`, [w, FIELD_H]);
  // Bind drag/drop while the hit-target is the last item (before the draws below).
  applyItemDnd(o.dnd);
  const hovered = ui.isItemHovered() && o.readonly !== true;
  const assigned = o.name !== undefined;

  // Field surface + border (accent on hover, like the focused inspector field).
  dl.rectFilled(min, max, srgbU32(p.gray4), 2);
  dl.rect(min, max, srgbU32(hovered ? p.green400 : p.gray6), 2, hovered ? 1.5 : 1);

  // Swatch: thumbnail (checkerboard backdrop) or the type's placeholder icon.
  const sw = FIELD_H - 8;
  const sMin: Vec2 = [min[0] + 4, min[1] + 4];
  const sMax: Vec2 = [sMin[0] + sw, sMin[1] + sw];
  const info = o.type !== undefined ? ASSET_TYPES[o.type] : undefined;
  if (o.thumbnail !== undefined) {
    dl.checkerboard(sMin, sMax, 6, srgbU32(p.gray5), srgbU32(p.gray3));
    dl.image(o.thumbnail, sMin, sMax);
  } else {
    dl.rectFilled(sMin, sMax, srgbU32(p.gray3), 2);
    const icon = info?.icon ?? 'image';
    const col = assigned && info !== undefined ? toneColors(info.tone).fg : srgbU32(p.textFaint);
    drawIcon(icon, [sMin[0] + (sw - 13) / 2, sMin[1] + (sw - 13) / 2], 13, col);
  }

  // Right-hand controls measured from the edge: target affordance, then type tag.
  const targetX = max[0] - FIELD_H + 6;
  drawIcon('circle-dot', [targetX, min[1] + (FIELD_H - 14) / 2], 14, srgbU32(hovered ? p.green400 : p.textMuted));
  let rightEdge = targetX - 6;
  if (assigned && info !== undefined && info.tag !== '') {
    const tc = toneColors(info.tone);
    const ts = ui.calcTextSize(info.tag);
    const tagW = ts[0] + 10;
    const tMin: Vec2 = [rightEdge - tagW, min[1] + (FIELD_H - ts[1] - 4) / 2];
    dl.rectFilled(tMin, [rightEdge, tMin[1] + ts[1] + 4], srgbU32(p.gray0, 0.8), 2);
    dl.text([tMin[0] + 5, tMin[1] + 2], tc.fg, info.tag);
    rightEdge = tMin[0] - 6;
  }

  // Name (or empty hint), clipped to the space between swatch and the controls.
  const nameX = sMax[0] + 7;
  const avail = Math.max(0, rightEdge - nameX);
  const cy = (min[1] + max[1]) / 2;
  if (assigned) {
    dl.text([nameX, cy - ui.textLineHeight() / 2], srgbU32(p.text), truncate(o.name!, avail));
  } else {
    const hint = o.expectsLabel !== undefined ? `None (${o.expectsLabel})` : 'None';
    dl.text([nameX, cy - ui.textLineHeight() / 2], srgbU32(p.textFaint), truncate(hint, avail));
  }

  return { clicked: clicked && o.readonly !== true };
};

const truncate = (text: string, maxW: number): string => {
  if (maxW <= 0) return '';
  if (ui.calcTextSize(text)[0] <= maxW) return text;
  let s = text;
  while (s.length > 1 && ui.calcTextSize(`${s}…`)[0] > maxW) s = s.slice(0, -1);
  return `${s}…`;
};
