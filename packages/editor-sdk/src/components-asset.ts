import { ImGui, ImGuiCol, type ImTextureRef } from '@mori2003/jsimgui';

import { Draw } from './draw';
import { drawIcon } from './icon-shapes';
import { type IconName } from './icons';
import { getActivePalette, packU32, srgbU32, type Tone, toneColors } from './palette';
import { ui } from './ui';
import type { Vec2 } from './units';

/** The asset kinds the browser knows how to preview. */
export type AssetType =
  | 'texture'
  | 'image'
  | 'sprite'
  | 'material'
  | 'mesh'
  | 'model'
  | 'skybox'
  | 'terrain'
  | 'scene'
  | 'prefab'
  | 'bundle'
  | 'script'
  | 'audio'
  | 'shader'
  | 'animation'
  | 'font'
  | 'particle'
  | 'folder';

/** Icon, format tag, and tone for an {@link AssetType}, mirrored from the design system registry. */
export interface AssetTypeInfo {
  readonly icon: IconName;
  readonly tag: string;
  readonly tone: Tone;
}

/** The type → preview descriptor table (the design system's `ASSET_TYPES`). */
export const ASSET_TYPES: Readonly<Record<AssetType, AssetTypeInfo>> = {
  texture: { icon: 'image', tag: 'TEX', tone: 'info' },
  image: { icon: 'image', tag: 'IMG', tone: 'info' },
  sprite: { icon: 'box-select', tag: 'SPRITE', tone: 'warning' },
  material: { icon: 'circle-dot', tag: 'MAT', tone: 'accent' },
  mesh: { icon: 'box', tag: 'MESH', tone: 'success' },
  model: { icon: 'box', tag: 'MODEL', tone: 'success' },
  skybox: { icon: 'cloud', tag: 'SKY', tone: 'info' },
  terrain: { icon: 'mountain', tag: 'TERRAIN', tone: 'success' },
  scene: { icon: 'clapperboard', tag: 'SCENE', tone: 'accent' },
  prefab: { icon: 'component', tag: 'PREFAB', tone: 'accent' },
  bundle: { icon: 'package', tag: 'BUNDLE', tone: 'accent' },
  script: { icon: 'file-code', tag: 'TS', tone: 'info' },
  audio: { icon: 'audio-lines', tag: 'AUDIO', tone: 'warning' },
  shader: { icon: 'file-code', tag: 'SHADER', tone: 'info' },
  animation: { icon: 'film', tag: 'ANIM', tone: 'warning' },
  font: { icon: 'type', tag: 'FONT', tone: 'neutral' },
  particle: { icon: 'sparkles', tag: 'VFX', tone: 'accent' },
  folder: { icon: 'folder', tag: '', tone: 'neutral' },
};

/** Options for {@link Widgets.assetCard}. */
export interface AssetCardOptions {
  readonly id: string;
  readonly name: string;
  readonly type: AssetType;
  readonly meta?: string | undefined;
  /** Preview tile size in px (e.g. 64 / 88 / 120). */
  readonly tile: number;
  /**
   * A generated preview texture to paint in the tile instead of the procedural
   * placeholder — one master image sampled at whatever `tile` size is shown.
   * Absent until the thumbnail is ready (the procedural preview shows meanwhile).
   */
  readonly thumbnail?: ImTextureRef | undefined;
  readonly selected?: boolean | undefined;
  readonly checked?: boolean | undefined;
  readonly error?: boolean | undefined;
  /** Sprite-sheet sub-asset count (renders a fold chip). */
  readonly subCount?: number | undefined;
  readonly expanded?: boolean | undefined;
}

const truncate = (name: string, maxW: number): string => {
  if (ui.calcTextSize(name)[0] <= maxW) return name;
  let s = name;
  while (s.length > 1 && ui.calcTextSize(`${s}…`)[0] > maxW) s = s.slice(0, -1);
  return `${s}…`;
};

const drawPreview = (o: AssetCardOptions, min: Vec2, size: number): void => {
  const dl = Draw.window();
  const p = getActivePalette();
  const max: Vec2 = [min[0] + size, min[1] + size];
  const cx = (min[0] + max[0]) / 2;
  const cy = (min[1] + max[1]) / 2;
  if (o.error === true) {
    dl.rectFilled(min, max, srgbU32(p.red400, 0.18), 3);
    drawIcon('image', [cx - 9, cy - 9], 18, srgbU32(p.red400));
    return;
  }
  // A ready thumbnail wins over the procedural placeholder: checkerboard behind
  // (so transparent images read correctly) then the generated master, sampled to
  // the tile size.
  if (o.thumbnail !== undefined) {
    dl.checkerboard(min, max, 8, srgbU32(p.gray5), srgbU32(p.gray3));
    dl.image(o.thumbnail, min, max);
    return;
  }
  const info = ASSET_TYPES[o.type];
  switch (o.type) {
    case 'texture':
    case 'image':
    case 'sprite': {
      dl.checkerboard(min, max, 8, srgbU32(p.gray5), srgbU32(p.gray3));
      const pad = size * 0.18;
      dl.rectFilled([min[0] + pad, min[1] + pad], [max[0] - pad, max[1] - pad], packU32(0x9a, 0x6b, 0x3f), 2);
      if (o.type === 'sprite') {
        dl.rect([min[0] + pad, min[1] + pad], [max[0] - pad, max[1] - pad], srgbU32(p.amber400), 0, 1.5);
      }
      break;
    }
    case 'material': {
      dl.rectFilled(min, max, srgbU32(p.gray1), 3);
      const r = size * 0.3;
      dl.circleFilled([cx, cy], r, srgbU32(p.green600));
      dl.circleFilled([cx - r * 0.3, cy - r * 0.3], r * 0.55, srgbU32(p.green300));
      break;
    }
    case 'mesh':
    case 'model': {
      dl.rectFilledMultiColor(min, max, srgbU32(p.gray3), srgbU32(p.gray3), srgbU32(p.gray1), srgbU32(p.gray1));
      dl.circleFilled([cx, max[1] - size * 0.18], size * 0.22, srgbU32(p.gray0, 0.5));
      drawIcon(info.icon, [cx - 11, cy - 14], 22, srgbU32(p.green400));
      break;
    }
    case 'skybox': {
      dl.rectFilledMultiColor(
        min,
        max,
        packU32(0x6a, 0xb4, 0xe0),
        packU32(0x6a, 0xb4, 0xe0),
        packU32(0xe8, 0xd6, 0xa8),
        packU32(0xe8, 0xd6, 0xa8),
      );
      break;
    }
    case 'terrain': {
      dl.rectFilledMultiColor(
        min,
        max,
        packU32(0x2f, 0x7d, 0x43),
        packU32(0x2f, 0x7d, 0x43),
        packU32(0x15, 0x42, 0x24),
        packU32(0x15, 0x42, 0x24),
      );
      break;
    }
    default: {
      dl.rectFilled(min, max, srgbU32(p.gray3), 3);
      const tc = toneColors(info.tone);
      drawIcon(info.icon, [cx - 11, cy - 11], 22, tc.fg);
    }
  }
};

/** Render an asset-browser tile. Returns whether it was clicked / its fold chip toggled. */
export const assetCard = (o: AssetCardOptions): { clicked: boolean; expandToggled: boolean } => {
  const p = getActivePalette();
  const size = o.tile;
  let expandToggled = false;
  let clicked = false;
  ui.withId(o.id, () => {
    ui.group(() => {
      const min = ui.cursorScreenPos();
      clicked = ui.invisibleButton('tile', [size, size]);
      const hovered = ui.isItemHovered();
      const dl = Draw.window();
      const max: Vec2 = [min[0] + size, min[1] + size];
      dl.rectFilled(min, max, srgbU32(p.gray2), 4);
      drawPreview(o, min, size);
      // Border / selection.
      if (o.selected === true) dl.rect(min, max, srgbU32(p.green400), 4, 1.5);
      else if (hovered) dl.rect(min, max, srgbU32(p.gray7), 4);
      else dl.rect(min, max, srgbU32(p.gray6), 4);
      // Type tag (bottom-left).
      const info = ASSET_TYPES[o.type];
      if (info.tag !== '') {
        const tc = toneColors(info.tone);
        const ts = ui.calcTextSize(info.tag);
        dl.rectFilled([min[0] + 4, max[1] - ts[1] - 8], [min[0] + ts[0] + 14, max[1] - 4], srgbU32(p.gray0, 0.8), 2);
        dl.text([min[0] + 9, max[1] - ts[1] - 6], tc.fg, info.tag);
      }
      // Multi-select checkbox on hover / when checked.
      if (o.checked === true || hovered) {
        const bx = min[0] + 6;
        const by = min[1] + 6;
        dl.rectFilled([bx, by], [bx + 16, by + 16], srgbU32(o.checked === true ? p.green400 : p.gray0, 0.85), 2);
        if (o.checked === true) drawIcon('check', [bx + 1, by + 1], 14, srgbU32(p.gray0));
      }
      // Sprite-sheet fold chip (bottom-right).
      if (o.subCount !== undefined) {
        const num = ` ${o.subCount}`;
        const ts = ui.calcTextSize(num);
        const cmin: Vec2 = [max[0] - ts[0] - 24, max[1] - ts[1] - 8];
        dl.rectFilled(cmin, [max[0] - 4, max[1] - 4], srgbU32(p.gray0, 0.85), 2);
        drawIcon(o.expanded === true ? 'chevron-down' : 'chevron-right', [cmin[0] + 3, cmin[1] + 1], 14, srgbU32(p.textMuted));
        dl.text([cmin[0] + 16, cmin[1] + 2], srgbU32(p.textMuted), num);
        const m = ui.mousePos();
        if (ui.isItemClicked() && m[0] >= cmin[0] && m[1] >= cmin[1]) expandToggled = true;
      }
      // Label + meta.
      const labelW = size - 4;
      ui.setCursorScreenPos([min[0], max[1] + 4]);
      const nameCol = o.error === true ? p.red400 : p.text;
      ImGui.PushStyleColor(ImGuiCol.Text, srgbU32(nameCol));
      ui.text(truncate(o.name, labelW));
      ImGui.PopStyleColor(1);
      if (o.meta !== undefined) ui.textDisabled(o.meta);
      else ui.dummy([labelW, ui.textLineHeight()]);
    });
  });
  return { clicked: clicked && !expandToggled, expandToggled };
};

/** Options for {@link Widgets.assetGroup}. */
export interface AssetGroupOptions {
  readonly id: string;
  readonly name: string;
  readonly meta?: string | undefined;
  readonly subCount: number;
  readonly tile: number;
  /** Render the sprite sub-tiles inside the drawer. */
  readonly body: () => void;
  readonly onCollapse?: () => void;
}

/** Render the full-width drawer for a texture's sprite sub-assets. */
export const assetGroup = (o: AssetGroupOptions): void => {
  const p = getActivePalette();
  ImGui.PushStyleColor(ImGuiCol.ChildBg, srgbU32(p.gray1, 0.6));
  ui.child(`grp-${o.id}`, { size: [0, o.tile + 78], border: true, padding: [8, 8] }, () => {
    ui.group(() => {
      ui.icon('image', [0.2, 0.78, 0.48, 1]);
      ui.sameLine();
      ui.alignTextToFramePadding();
      ui.text(o.name);
      ui.sameLine();
      ui.textDisabled(`· ${o.subCount} sprites${o.meta !== undefined ? ` · ${o.meta}` : ''}`);
      ui.sameLine();
      ui.rightAlign(22);
      const cs = ui.cursorScreenPos();
      if (ui.button(`##collapse-${o.id}`, [22, 22])) o.onCollapse?.();
      drawIcon('chevrons-down-up', [cs[0] + 4, cs[1] + 4], 14, srgbU32(p.textMuted));
    });
    ui.separator();
    o.body();
  });
  ImGui.PopStyleColor(1);
};
