import type { Mat4 } from 'wgpu-matrix';

import type { Aabb } from './aabb';
import { Plane } from './plane';

/**
 * The six bounding planes of a view's truncated pyramid, with normals
 * pointing *into* the visible region — i.e. a world-space point is inside
 * the frustum iff every plane reports `signedDistance >= 0`.
 *
 * The plane order is fixed: `[left, right, bottom, top, near, far]`. The
 * value is rebuilt each frame from the camera's view-projection matrix via
 * {@link Frustum.fromViewProj}.
 */
export class Frustum {
  /** Six inward-facing half-spaces in the canonical order. */
  readonly planes: readonly [Plane, Plane, Plane, Plane, Plane, Plane];

  constructor() {
    this.planes = [new Plane(), new Plane(), new Plane(), new Plane(), new Plane(), new Plane()];
  }

  /**
   * Extract the six clip-volume planes from a column-major view-projection
   * matrix using the Gribb–Hartmann method, then normalise each plane.
   *
   * Assumes WebGPU clip space (z ∈ [0, 1]). The near plane is `row2` and
   * the far plane is `row3 − row2`; side planes are `row3 ± row{0,1}` as
   * usual. Per WebGPU's column-major layout the `i`-th row is read as
   * `(m[i], m[4+i], m[8+i], m[12+i])`.
   *
   * Writes into `dst` when supplied; otherwise allocates a fresh `Frustum`.
   */
  static fromViewProj(viewProj: Mat4, dst?: Frustum): Frustum {
    const out = dst ?? new Frustum();
    const m0 = viewProj[0]!,
      m1 = viewProj[1]!,
      m2 = viewProj[2]!,
      m3 = viewProj[3]!;
    const m4 = viewProj[4]!,
      m5 = viewProj[5]!,
      m6 = viewProj[6]!,
      m7 = viewProj[7]!;
    const m8 = viewProj[8]!,
      m9 = viewProj[9]!,
      m10 = viewProj[10]!,
      m11 = viewProj[11]!;
    const m12 = viewProj[12]!,
      m13 = viewProj[13]!,
      m14 = viewProj[14]!,
      m15 = viewProj[15]!;
    // row0 = (m0, m4, m8, m12); row1 = (m1, m5, m9, m13);
    // row2 = (m2, m6, m10, m14); row3 = (m3, m7, m11, m15).
    out.planes[0]!.setFromCoefficients(m3 + m0, m7 + m4, m11 + m8, m15 + m12); // left
    out.planes[1]!.setFromCoefficients(m3 - m0, m7 - m4, m11 - m8, m15 - m12); // right
    out.planes[2]!.setFromCoefficients(m3 + m1, m7 + m5, m11 + m9, m15 + m13); // bottom
    out.planes[3]!.setFromCoefficients(m3 - m1, m7 - m5, m11 - m9, m15 - m13); // top
    out.planes[4]!.setFromCoefficients(m2, m6, m10, m14); // near (WebGPU z∈[0,1])
    out.planes[5]!.setFromCoefficients(m3 - m2, m7 - m6, m11 - m10, m15 - m14); // far
    return out;
  }
}

/**
 * Conservatively test whether a world-space {@link Aabb} touches or lies
 * inside the {@link Frustum}. Returns `false` when the box is fully outside
 * any single plane, `true` otherwise.
 *
 * The test is the "positive vertex" form: for each plane, the signed
 * distance from the AABB centre is offset by the projection of the
 * half-extents onto the absolute plane normal — `|n.x|·h.x + |n.y|·h.y +
 * |n.z|·h.z` — to reach the corner furthest along the normal. If even that
 * corner is on the wrong side, the whole box is rejected.
 *
 * Pass a *world-space* AABB; rotate/scale a local-space `Aabb` first with
 * `Aabb.transform(source, worldFromLocal, dst)`.
 */
export const frustumIntersectsAabb = (frustum: Frustum, aabbWorld: Aabb): boolean => {
  const cx = aabbWorld.center[0]!,
    cy = aabbWorld.center[1]!,
    cz = aabbWorld.center[2]!;
  const hx = aabbWorld.halfExtents[0]!,
    hy = aabbWorld.halfExtents[1]!,
    hz = aabbWorld.halfExtents[2]!;
  for (let i = 0; i < 6; i++) {
    const p = frustum.planes[i]!;
    const nx = p.normal[0]!,
      ny = p.normal[1]!,
      nz = p.normal[2]!;
    const centerDistance = nx * cx + ny * cy + nz * cz + p.d;
    const positiveOffset = Math.abs(nx) * hx + Math.abs(ny) * hy + Math.abs(nz) * hz;
    if (centerDistance + positiveOffset < 0) return false;
  }
  return true;
};
