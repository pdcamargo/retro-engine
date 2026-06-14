import type { Draw } from '../draw';
import { packU32 } from '../palette';
import type { Vec2 } from '../units';

const LABEL_BG = packU32(0x12, 0x16, 0x1c, 220);
const LABEL_TEXT = packU32(0xf0, 0xf3, 0xf7, 255);

/**
 * A dashed line from `a` to `b`. `ImDrawList` has no dashed primitive, so this
 * walks the segment emitting `dash`-long strokes separated by `gap`.
 */
export const dashedLine = (
  draw: Draw,
  a: Vec2,
  b: Vec2,
  col: number,
  dash = 6,
  gap = 4,
  thickness = 1.5,
): void => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-3) return;
  const ux = dx / len;
  const uy = dy / len;
  const stride = dash + gap;
  for (let d = 0; d < len; d += stride) {
    const s = d;
    const e = Math.min(d + dash, len);
    draw.line([a[0] + ux * s, a[1] + uy * s], [a[0] + ux * e, a[1] + uy * e], col, thickness);
  }
};

/**
 * A small text chip with a rounded background, anchored just below-right of
 * `pos`. Used for the live drag readout (delta, angle, scale factor).
 */
export const labelChip = (draw: Draw, pos: Vec2, text: string, charWidth = 7, lineHeight = 16): void => {
  const padX = 6;
  const padY = 3;
  const x = pos[0] + 14;
  const y = pos[1] + 14;
  const w = text.length * charWidth + padX * 2;
  const h = lineHeight + padY * 2;
  draw.rectFilled([x, y], [x + w, y + h], LABEL_BG, 3);
  draw.text([x + padX, y + padY], LABEL_TEXT, text);
};
