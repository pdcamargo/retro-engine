import { ImVec4 } from '@mori2003/jsimgui';

import { defaultTokens, type RetroPalette } from './tokens';
import type { Srgb8 } from './units';

let active: RetroPalette = defaultTokens.palette;

/**
 * Record the palette currently applied to the UI style. {@link applyTheme} calls
 * this so component helpers (badges, axis chips, selection rails, asset tiles)
 * can draw with the same colors the theme installed, instead of hardcoding them.
 */
export const setActivePalette = (palette: RetroPalette): void => {
  active = palette;
};

/** The palette currently applied to the UI style. */
export const getActivePalette = (): RetroPalette => active;

/**
 * Pack 8-bit RGBA channels into the `ImU32` (`0xAABBGGRR`) the draw list expects.
 * Equivalent to Dear ImGui's `IM_COL32`.
 */
export const packU32 = (r: number, g: number, b: number, a = 255): number =>
  ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;

/** An {@link Srgb8} color (with optional `0..1` alpha) as a draw-list `ImU32`. */
export const srgbU32 = (c: Srgb8, alpha = 1): number =>
  packU32(c[0], c[1], c[2], Math.round(Math.max(0, Math.min(1, alpha)) * 255));

/** An {@link Srgb8} color (with optional `0..1` alpha) as an `ImVec4` for style colors. */
export const srgbV4 = (c: Srgb8, alpha = 1): ImVec4 =>
  new ImVec4(c[0] / 255, c[1] / 255, c[2] / 255, alpha);

/** The semantic axis for a vector component: X red, Y green, Z cyan (fixed convention). */
export type Axis = 'x' | 'y' | 'z';

/** The {@link Srgb8} color for an axis chip — X red, Y green, Z cyan. */
export const axisColor = (axis: Axis): Srgb8 => {
  const p = active;
  return axis === 'x' ? p.red400 : axis === 'y' ? p.green400 : p.cyan400;
};

/** The tone of a {@link Badge} — maps to a soft fill + a solid foreground. */
export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'solid' | 'outline';

/** Background fill, foreground text, and optional border for a badge {@link Tone}. */
export interface ToneColors {
  readonly bg: number;
  readonly fg: number;
  readonly border?: number;
}

/** Resolve the draw colors for a badge {@link Tone} against the active palette. */
export const toneColors = (tone: Tone): ToneColors => {
  const p = active;
  switch (tone) {
    case 'accent':
      return { bg: srgbU32(p.green400, 0.16), fg: srgbU32(p.green400) };
    case 'success':
      return { bg: srgbU32(p.green600, 0.2), fg: srgbU32(p.green300) };
    case 'warning':
      return { bg: srgbU32(p.amber400, 0.16), fg: srgbU32(p.amber400) };
    case 'danger':
      return { bg: srgbU32(p.red400, 0.16), fg: srgbU32(p.red400) };
    case 'info':
      return { bg: srgbU32(p.cyan400, 0.16), fg: srgbU32(p.cyan400) };
    case 'solid':
      return { bg: srgbU32(p.green400), fg: srgbU32(p.gray0) };
    case 'outline':
      return { bg: srgbU32(p.gray0, 0), fg: srgbU32(p.textMuted), border: srgbU32(p.gray6) };
    case 'neutral':
    default:
      return { bg: srgbU32(p.gray5, 0.6), fg: srgbU32(p.textMuted) };
  }
};
