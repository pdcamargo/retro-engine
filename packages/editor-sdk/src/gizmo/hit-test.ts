import type { Mat4, Vec3 } from '@retro-engine/math';

import type { Vec2 } from '../units';

/** Viewport rect a world point projects into. */
export interface ScreenViewport {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Project a world point to viewport pixels via `viewProj`, or `null` when it
 * lies on/behind the camera plane (clip `w <= 0`). Y grows downward, matching
 * cursor coordinates.
 */
export const worldToScreen = (p: Vec3, viewProj: Mat4, vp: ScreenViewport): Vec2 | null => {
  const x = p[0]!;
  const y = p[1]!;
  const z = p[2]!;
  // Column-major mat4 * vec4(p, 1).
  const cx = viewProj[0]! * x + viewProj[4]! * y + viewProj[8]! * z + viewProj[12]!;
  const cy = viewProj[1]! * x + viewProj[5]! * y + viewProj[9]! * z + viewProj[13]!;
  const cw = viewProj[3]! * x + viewProj[7]! * y + viewProj[11]! * z + viewProj[15]!;
  if (cw <= 1e-6) return null;
  const ndcX = cx / cw;
  const ndcY = cy / cw;
  return [vp.x + (ndcX * 0.5 + 0.5) * vp.width, vp.y + (1 - (ndcY * 0.5 + 0.5)) * vp.height];
};

/** Euclidean distance between two screen points. */
export const distance2D = (a: Vec2, b: Vec2): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Shortest distance from point `p` to the segment `a`–`b`, all in screen pixels. */
export const pointSegmentDistance2D = (p: Vec2, a: Vec2, b: Vec2): number => {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const lenSq = abx * abx + aby * aby;
  if (lenSq < 1e-9) return distance2D(p, a);
  let t = ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = a[0] + abx * t;
  const projY = a[1] + aby * t;
  return Math.hypot(p[0] - projX, p[1] - projY);
};

/**
 * Distance from `p` to the perimeter of the (projected) circle approximated by
 * its screen center and a screen-space radius — `||p - center| - radius|`. Good
 * enough for ring hit-testing where the ellipse foreshortening is mild.
 */
export const pointRingDistance2D = (p: Vec2, center: Vec2, radius: number): number =>
  Math.abs(distance2D(p, center) - radius);
