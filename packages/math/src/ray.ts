import type { Mat4, Vec3 } from 'wgpu-matrix';
import { vec3 } from 'wgpu-matrix';

import type { Plane } from './plane';

/** Direction vectors shorter than this are treated as degenerate. */
const EPSILON = 1e-6;

// Scratch storage reused by `Ray.fromScreen` so a per-frame call allocates nothing.
const scratchNear = vec3.create(0, 0, 0);
const scratchFar = vec3.create(0, 0, 0);

/**
 * A half-line in 3D space: all points `origin + direction * t` for `t >= 0`.
 *
 * {@link direction} is kept unit length, so the parameter `t` returned by the
 * intersection helpers is a true Euclidean distance along the ray.
 */
export class Ray {
  /** Starting point of the ray. Stored as a fresh `Vec3` per instance. */
  readonly origin: Vec3;

  /** Unit-length ray direction. Stored as a fresh `Vec3` per instance. */
  readonly direction: Vec3;

  constructor(origin?: Vec3, direction?: Vec3) {
    this.origin = origin !== undefined ? vec3.clone(origin) : vec3.create(0, 0, 0);
    this.direction = direction !== undefined ? vec3.normalize(direction) : vec3.create(0, 0, 1);
  }

  /**
   * The point at distance `t` along the ray: `origin + direction * t`. Writes
   * into `dst` when supplied; otherwise allocates a fresh `Vec3`.
   */
  at(t: number, dst?: Vec3): Vec3 {
    const out = dst ?? vec3.create(0, 0, 0);
    out[0] = this.origin[0]! + this.direction[0]! * t;
    out[1] = this.origin[1]! + this.direction[1]! * t;
    out[2] = this.origin[2]! + this.direction[2]! * t;
    return out;
  }

  /**
   * Build the world-space pick ray through a viewport pixel.
   *
   * `screenX`/`screenY` are in pixels, measured from the top-left of the
   * viewport rect `(viewportX, viewportY, viewportWidth, viewportHeight)` — so
   * `(viewportX, viewportY)` maps to the top-left corner and Y grows downward,
   * matching cursor coordinates. `invViewProj` is the inverse of the camera's
   * `projection * view` matrix.
   *
   * The pixel is unprojected at the near plane (clip-space `z = 0`) and the far
   * plane (`z = 1`) and the ray runs between them. The `[0, 1]` clip-space depth
   * range is the WebGPU convention; do not apply the OpenGL `2 * z - 1` remap.
   * Works for both perspective and orthographic projections (an orthographic
   * `invViewProj` yields parallel rays whose origin shifts with the pixel).
   *
   * Writes into `dst` when supplied; otherwise allocates a fresh `Ray`.
   */
  static fromScreen(
    screenX: number,
    screenY: number,
    viewportX: number,
    viewportY: number,
    viewportWidth: number,
    viewportHeight: number,
    invViewProj: Mat4,
    dst?: Ray,
  ): Ray {
    const out = dst ?? new Ray();
    const ndcX = ((screenX - viewportX) / viewportWidth) * 2 - 1;
    const ndcY = (1 - (screenY - viewportY) / viewportHeight) * 2 - 1;
    // `vec3.transformMat4` divides by the resulting w, so these are true world points.
    scratchNear[0] = ndcX;
    scratchNear[1] = ndcY;
    scratchNear[2] = 0;
    scratchFar[0] = ndcX;
    scratchFar[1] = ndcY;
    scratchFar[2] = 1;
    vec3.transformMat4(scratchNear, invViewProj, out.origin);
    vec3.transformMat4(scratchFar, invViewProj, out.direction);
    out.direction[0]! -= out.origin[0]!;
    out.direction[1]! -= out.origin[1]!;
    out.direction[2]! -= out.origin[2]!;
    vec3.normalize(out.direction, out.direction);
    return out;
  }
}

/**
 * Distance along `ray` to its intersection with `plane`, or `NaN` when the ray
 * is parallel to the plane. The hit point is `ray.at(t)`; a negative `t` means
 * the plane lies behind the ray origin.
 *
 * Solves `normal · (origin + direction * t) + d = 0` for `t`, i.e.
 * `t = -(normal · origin + d) / (normal · direction)`.
 */
export const rayPlaneIntersect = (ray: Ray, plane: Plane): number => {
  const denom =
    plane.normal[0]! * ray.direction[0]! +
    plane.normal[1]! * ray.direction[1]! +
    plane.normal[2]! * ray.direction[2]!;
  if (Math.abs(denom) < EPSILON) return NaN;
  return -(plane.signedDistance(ray.origin)) / denom;
};

/** Closest-point result for {@link rayClosestPointToRay}. */
export interface RayRayClosest {
  /** The point on `rayA` closest to `rayB`. */
  readonly point: Vec3;
  /** Distance along `rayA` to {@link point}. */
  readonly tA: number;
  /** Distance along `rayB` to its own closest point. */
  readonly tB: number;
}

/**
 * Closest point on `rayA` to `rayB`, treating both as infinite lines.
 *
 * This is the primitive behind axis-constrained gizmo dragging: pass the world
 * axis (origin at the pivot, unit `direction`) as `rayA` and the mouse pick ray
 * as `rayB`; the returned `tA` is the signed distance the cursor maps to along
 * that axis. When the lines are near-parallel `tA`/`tB` fall back to `0`.
 *
 * Uses the standard skew-line solution: with `r = originA - originB`,
 * `a = dirA·dirA`, `b = dirA·dirB`, `c = dirB·dirB`, `d = dirA·r`, `e = dirB·r`,
 * `tA = (b·e - c·d) / (a·c - b²)`. Writes the point into `dst` when supplied.
 */
export const rayClosestPointToRay = (rayA: Ray, rayB: Ray, dst?: Vec3): RayRayClosest => {
  const da = rayA.direction;
  const db = rayB.direction;
  const rx = rayA.origin[0]! - rayB.origin[0]!;
  const ry = rayA.origin[1]! - rayB.origin[1]!;
  const rz = rayA.origin[2]! - rayB.origin[2]!;
  const a = da[0]! * da[0]! + da[1]! * da[1]! + da[2]! * da[2]!;
  const b = da[0]! * db[0]! + da[1]! * db[1]! + da[2]! * db[2]!;
  const c = db[0]! * db[0]! + db[1]! * db[1]! + db[2]! * db[2]!;
  const d = da[0]! * rx + da[1]! * ry + da[2]! * rz;
  const e = db[0]! * rx + db[1]! * ry + db[2]! * rz;
  const denom = a * c - b * b;
  let tA = 0;
  let tB = 0;
  if (Math.abs(denom) >= EPSILON) {
    tA = (b * e - c * d) / denom;
    tB = (a * e - b * d) / denom;
  }
  return { point: rayA.at(tA, dst), tA, tB };
};

/**
 * Signed angle in radians, in `[-π, π]`, that rotates `from` to `to` about
 * `planeNormal` (right-hand rule). Both vectors are assumed to lie in the plane
 * with the given normal; their lengths do not need to match.
 *
 * Computed as `atan2((from × to) · planeNormal, from · to)` — the `atan2` form
 * is stable near `0` and `±π` where an `acos`-based formula loses precision.
 */
export const signedAngleOnPlane = (from: Vec3, to: Vec3, planeNormal: Vec3): number => {
  const cx = from[1]! * to[2]! - from[2]! * to[1]!;
  const cy = from[2]! * to[0]! - from[0]! * to[2]!;
  const cz = from[0]! * to[1]! - from[1]! * to[0]!;
  const sin = cx * planeNormal[0]! + cy * planeNormal[1]! + cz * planeNormal[2]!;
  const cos = from[0]! * to[0]! + from[1]! * to[1]! + from[2]! * to[2]!;
  return Math.atan2(sin, cos);
};
