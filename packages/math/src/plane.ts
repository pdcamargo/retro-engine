import type { Vec3 } from 'wgpu-matrix';
import { vec3 } from 'wgpu-matrix';

/**
 * An oriented plane in 3D space, stored as a unit normal and a signed offset
 * along that normal from the origin: points satisfying `normal · p + d = 0`
 * lie on the plane, points with `normal · p + d > 0` are in the half-space the
 * normal points into ("inside" for a frustum plane), and points with
 * `normal · p + d < 0` are on the opposite side.
 *
 * The plane is canonically normalised — `|normal| === 1` — so `signedDistance`
 * returns a true Euclidean distance. Constructors and the in-place
 * {@link setFromCoefficients} helper enforce normalisation; mutating fields
 * directly is allowed but skips that step.
 */
export class Plane {
  /** Unit-length plane normal. Stored as a fresh `Vec3` per instance. */
  readonly normal: Vec3;

  /** Signed offset along {@link normal}: `normal · p + d = 0` on the plane. */
  d: number;

  constructor(normal?: Vec3, d: number = 0) {
    this.normal = normal !== undefined ? vec3.clone(normal) : vec3.create(0, 0, 0);
    this.d = d;
  }

  /**
   * Write the plane equation `ax + by + cz + d = 0` and normalise so the
   * stored normal is unit length. Returns `this` for chaining.
   */
  setFromCoefficients(a: number, b: number, c: number, d: number): this {
    const lenSq = a * a + b * b + c * c;
    if (lenSq > 0) {
      const inv = 1 / Math.sqrt(lenSq);
      this.normal[0] = a * inv;
      this.normal[1] = b * inv;
      this.normal[2] = c * inv;
      this.d = d * inv;
    } else {
      this.normal[0] = 0;
      this.normal[1] = 0;
      this.normal[2] = 0;
      this.d = d;
    }
    return this;
  }

  /**
   * Signed Euclidean distance from `point` to this plane. Positive when
   * `point` lies on the side the normal points into.
   */
  signedDistance(point: Vec3): number {
    return this.normal[0]! * point[0]! + this.normal[1]! * point[1]! + this.normal[2]! * point[2]! + this.d;
  }
}
