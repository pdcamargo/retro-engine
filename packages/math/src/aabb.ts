import type { Mat4, Vec3 } from 'wgpu-matrix';
import { vec3 } from 'wgpu-matrix';

/**
 * Axis-aligned bounding box stored as a centre point and per-axis
 * half-extents. The box covers `[center.x - halfExtents.x, center.x + halfExtents.x]`
 * on the X axis, and analogously on Y and Z.
 *
 * The centre + half-extents form is intentional: it makes plane-vs-box
 * distance tests (`|n.x|*h.x + |n.y|*h.y + |n.z|*h.z`) cheaper than the
 * `{ min, max }` form, which matters for visibility culling that touches
 * every renderable each frame.
 *
 * AABBs are typically declared in an entity's local space and transformed
 * into world space via {@link Aabb.transform} each frame against the entity's
 * `GlobalTransform`. The result is a conservative axis-aligned bound of the
 * possibly-rotated, possibly-scaled local box.
 */
export class Aabb {
  /** Centre of the box in the coordinate space the AABB is declared in. */
  readonly center: Vec3;

  /** Half the extent of the box along each axis. All components are `>= 0`. */
  readonly halfExtents: Vec3;

  constructor(center?: Vec3, halfExtents?: Vec3) {
    this.center = center !== undefined ? vec3.clone(center) : vec3.create(0, 0, 0);
    this.halfExtents = halfExtents !== undefined ? vec3.clone(halfExtents) : vec3.create(0, 0, 0);
  }

  /**
   * Build an AABB from `{ min, max }` corners. `min[i] <= max[i]` is assumed
   * and not validated — passing inverted corners produces an inverted box.
   * Writes into `dst` when supplied; otherwise allocates a fresh `Aabb`.
   */
  static fromMinMax(min: Vec3, max: Vec3, dst?: Aabb): Aabb {
    const out = dst ?? new Aabb();
    out.center[0] = (min[0]! + max[0]!) * 0.5;
    out.center[1] = (min[1]! + max[1]!) * 0.5;
    out.center[2] = (min[2]! + max[2]!) * 0.5;
    out.halfExtents[0] = (max[0]! - min[0]!) * 0.5;
    out.halfExtents[1] = (max[1]! - min[1]!) * 0.5;
    out.halfExtents[2] = (max[2]! - min[2]!) * 0.5;
    return out;
  }

  /**
   * Build the tightest AABB containing every point in `points`. The input is
   * either an array of `Vec3` or a flat `Float32Array` of `[x0, y0, z0, x1, ...]`
   * triples; in the latter case `points.length` must be a multiple of 3.
   *
   * An empty input returns a zero-sized AABB centred at the origin. Writes
   * into `dst` when supplied; otherwise allocates a fresh `Aabb`.
   */
  static fromPoints(points: ReadonlyArray<Vec3> | Float32Array, dst?: Aabb): Aabb {
    const out = dst ?? new Aabb();
    if (points instanceof Float32Array) {
      if (points.length === 0) {
        out.center[0] = 0;
        out.center[1] = 0;
        out.center[2] = 0;
        out.halfExtents[0] = 0;
        out.halfExtents[1] = 0;
        out.halfExtents[2] = 0;
        return out;
      }
      let minX = points[0]!,
        minY = points[1]!,
        minZ = points[2]!;
      let maxX = minX,
        maxY = minY,
        maxZ = minZ;
      for (let i = 3; i < points.length; i += 3) {
        const x = points[i]!,
          y = points[i + 1]!,
          z = points[i + 2]!;
        if (x < minX) minX = x;
        else if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        else if (y > maxY) maxY = y;
        if (z < minZ) minZ = z;
        else if (z > maxZ) maxZ = z;
      }
      out.center[0] = (minX + maxX) * 0.5;
      out.center[1] = (minY + maxY) * 0.5;
      out.center[2] = (minZ + maxZ) * 0.5;
      out.halfExtents[0] = (maxX - minX) * 0.5;
      out.halfExtents[1] = (maxY - minY) * 0.5;
      out.halfExtents[2] = (maxZ - minZ) * 0.5;
      return out;
    }
    if (points.length === 0) {
      out.center[0] = 0;
      out.center[1] = 0;
      out.center[2] = 0;
      out.halfExtents[0] = 0;
      out.halfExtents[1] = 0;
      out.halfExtents[2] = 0;
      return out;
    }
    const first = points[0]!;
    let minX = first[0]!,
      minY = first[1]!,
      minZ = first[2]!;
    let maxX = minX,
      maxY = minY,
      maxZ = minZ;
    for (let i = 1; i < points.length; i++) {
      const p = points[i]!;
      const x = p[0]!,
        y = p[1]!,
        z = p[2]!;
      if (x < minX) minX = x;
      else if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      else if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      else if (z > maxZ) maxZ = z;
    }
    out.center[0] = (minX + maxX) * 0.5;
    out.center[1] = (minY + maxY) * 0.5;
    out.center[2] = (minZ + maxZ) * 0.5;
    out.halfExtents[0] = (maxX - minX) * 0.5;
    out.halfExtents[1] = (maxY - minY) * 0.5;
    out.halfExtents[2] = (maxZ - minZ) * 0.5;
    return out;
  }

  /**
   * Compute the world-space AABB of an entity whose local-space bounds are
   * `source` and whose world transform is `worldFromLocal` (column-major
   * 4×4, wgpu-matrix convention). The result is the tightest axis-aligned
   * box containing the eight transformed corners of `source` — conservative
   * for rotation/scale, exact when `worldFromLocal` is a pure translation.
   *
   * Writes into `dst` when supplied; otherwise allocates a fresh `Aabb`.
   * Safe to call with `dst === source` (the new centre and extents are
   * computed before the first write).
   */
  static transform(source: Aabb, worldFromLocal: Mat4, dst?: Aabb): Aabb {
    const out = dst ?? new Aabb();
    const cx = source.center[0]!,
      cy = source.center[1]!,
      cz = source.center[2]!;
    const hx = source.halfExtents[0]!,
      hy = source.halfExtents[1]!,
      hz = source.halfExtents[2]!;
    // Column-major: m[0..3] = column 0, m[4..7] = column 1, ...
    // Row 0 of upper-left 3×3 is (m[0], m[4], m[8]); row 1 is (m[1], m[5], m[9]); row 2 is (m[2], m[6], m[10]).
    const m00 = worldFromLocal[0]!,
      m10 = worldFromLocal[1]!,
      m20 = worldFromLocal[2]!;
    const m01 = worldFromLocal[4]!,
      m11 = worldFromLocal[5]!,
      m21 = worldFromLocal[6]!;
    const m02 = worldFromLocal[8]!,
      m12 = worldFromLocal[9]!,
      m22 = worldFromLocal[10]!;
    const tx = worldFromLocal[12]!,
      ty = worldFromLocal[13]!,
      tz = worldFromLocal[14]!;
    const newCx = m00 * cx + m01 * cy + m02 * cz + tx;
    const newCy = m10 * cx + m11 * cy + m12 * cz + ty;
    const newCz = m20 * cx + m21 * cy + m22 * cz + tz;
    const newHx = Math.abs(m00) * hx + Math.abs(m01) * hy + Math.abs(m02) * hz;
    const newHy = Math.abs(m10) * hx + Math.abs(m11) * hy + Math.abs(m12) * hz;
    const newHz = Math.abs(m20) * hx + Math.abs(m21) * hy + Math.abs(m22) * hz;
    out.center[0] = newCx;
    out.center[1] = newCy;
    out.center[2] = newCz;
    out.halfExtents[0] = newHx;
    out.halfExtents[1] = newHy;
    out.halfExtents[2] = newHz;
    return out;
  }
}
