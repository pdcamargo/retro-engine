/**
 * Wire rendering. A wire is a chain of cubic beziers with horizontal tangents,
 * drawn from screen-space anchors (source pin → reroute knots → target pin) so
 * it stays live as nodes/knots move. The handle length `k = clamp(|dx|·0.5, …)`
 * gives the signature horizontal-exit/entry shape; clamp bounds scale with zoom.
 */

import type { Draw } from '@retro-engine/editor-sdk';

import type { Point } from './document';

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Horizontal tangent handle length between two screen points at a given zoom. */
export const wireTangent = (ax: number, bx: number, zoom: number): number =>
  clamp(Math.abs(bx - ax) * 0.5, 26 * zoom, 150 * zoom);

/**
 * Draw a wire through ordered screen points (≥2). Emits one cubic bezier per
 * consecutive pair, each exiting/entering horizontally so reroute knots visibly
 * bend the curve.
 */
export const drawWire = (
  draw: Draw,
  pts: readonly Point[],
  col: number,
  thickness: number,
  zoom: number,
): void => {
  if (pts.length < 2) return;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const k = wireTangent(a[0], b[0], zoom);
    draw.bezierCubic(a, [a[0] + k, a[1]], [b[0] - k, b[1]], b, col, thickness);
  }
};
