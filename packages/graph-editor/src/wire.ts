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

const distToSegment2 = (px: number, py: number, ax: number, ay: number, bx: number, by: number): number => {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return (px - cx) ** 2 + (py - cy) ** 2;
};

/**
 * Minimum distance (in the same units as `pts`) from a point to a wire drawn
 * through `pts`, matching {@link drawWire}'s geometry by sampling each cubic
 * segment into a short polyline. Used for wire hit-testing.
 */
export const wireDistance = (
  pts: readonly Point[],
  px: number,
  py: number,
  zoom: number,
  samples = 14,
): number => {
  if (pts.length < 2) return Infinity;
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const k = wireTangent(a[0], b[0], zoom);
    const c1x = a[0] + k;
    const c2x = b[0] - k;
    let prevX = a[0];
    let prevY = a[1];
    for (let s = 1; s <= samples; s++) {
      const t = s / samples;
      const u = 1 - t;
      const w0 = u * u * u;
      const w1 = 3 * u * u * t;
      const w2 = 3 * u * t * t;
      const w3 = t * t * t;
      const x = w0 * a[0] + w1 * c1x + w2 * c2x + w3 * b[0];
      const y = w0 * a[1] + w1 * a[1] + w2 * b[1] + w3 * b[1];
      const d = distToSegment2(px, py, prevX, prevY, x, y);
      if (d < best) best = d;
      prevX = x;
      prevY = y;
    }
  }
  return Math.sqrt(best);
};
