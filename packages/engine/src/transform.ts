import type { Mat4, Quat, Vec3 } from '@retro-engine/math';
import { mat4, quat, vec3 } from '@retro-engine/math';

/**
 * World-space transform of an entity, kept in sync each frame by the engine's
 * propagation system (runs in `'postUpdate'`). Holds a single column-major
 * `Mat4` populated from the entity's local `Transform` composed with its
 * ancestor chain.
 *
 * Auto-attached to any entity that spawns with a `Transform` — `Transform`
 * declares `static requires = [GlobalTransform]`, so consumers normally do not
 * construct one directly.
 *
 * The matrix is stable storage: the propagation system writes into the same
 * `Float32Array` each frame, so consumers (renderer extract, debug viz) can
 * cache the reference. Render-side reads should happen in `'postUpdate'`,
 * `'last'`, or `'render'` to see the current frame's values; reads in earlier
 * stages see the prior frame's values.
 */
export class GlobalTransform {
  /**
   * Column-major 4x4 world matrix `T_world = T_parent * T_local`. Identity for
   * a freshly-spawned `Transform` until the next `'postUpdate'` pass writes it.
   */
  readonly matrix: Mat4 = mat4.identity();
}

/**
 * Local-space transform of an entity: translation, rotation, and scale relative
 * to the entity's parent (or world space if the entity has no `Parent`). One
 * component covers 2D (z = 0, Z-axis rotation) and 3D — there is no separate
 * `Transform2D`.
 *
 * Spawning an entity with a `Transform` auto-inserts a `GlobalTransform`
 * (Required Component, see {@link Transform.requires}). The engine's
 * propagation system runs in `'postUpdate'` and writes `GlobalTransform.matrix`
 * from this entity's local TRS and its ancestor chain through `Parent`.
 *
 * Field types are wgpu-matrix `Vec3` / `Quat` (`Float32Array` flavour).
 * Mutate fields in place from systems — the propagation pass re-reads them
 * each frame.
 *
 * @example
 * ```ts
 * import { Transform } from '@retro-engine/engine';
 * import { quat, vec3 } from '@retro-engine/math';
 *
 * cmd.spawn(new Transform(vec3.create(10, 0, 0), quat.identity(), vec3.create(2, 2, 1)));
 * ```
 */
export class Transform {
  /** Translation in the parent's frame (or world space if no parent). */
  translation: Vec3;
  /** Rotation in the parent's frame. Identity = no rotation. */
  rotation: Quat;
  /** Per-axis scale in the parent's frame. (1, 1, 1) = no scaling. */
  scale: Vec3;

  /**
   * Construct a `Transform`. Omitted fields default to identity:
   * translation `(0, 0, 0)`, rotation identity, scale `(1, 1, 1)`. Default
   * fields allocate fresh storage per instance — safe to mutate without
   * cross-instance aliasing.
   */
  constructor(translation?: Vec3, rotation?: Quat, scale?: Vec3) {
    this.translation = translation ?? vec3.create(0, 0, 0);
    this.rotation = rotation ?? quat.identity();
    this.scale = scale ?? vec3.create(1, 1, 1);
  }

  /**
   * Required Components declaration: spawning an entity with `Transform`
   * auto-inserts a default-constructed `GlobalTransform`. See ECS Required
   * Components mechanism in `@retro-engine/ecs`.
   */
  static readonly requires = [GlobalTransform];
}

/**
 * Compose local TRS into a column-major 4x4 matrix in-place. The output is
 * `T_translation * R_rotation * S_scale` — the standard SRT-applied-as-TRS
 * order, equivalent to scaling first, then rotating, then translating when
 * the matrix is applied to a column vector.
 *
 * Layout (column-major, wgpu-matrix convention):
 * - `out[0..3]` = column 0 = `R * (s.x, 0, 0)`
 * - `out[4..7]` = column 1 = `R * (0, s.y, 0)`
 * - `out[8..11]` = column 2 = `R * (0, 0, s.z)`
 * - `out[12..15]` = column 3 = `(t.x, t.y, t.z, 1)`
 *
 * Writes to `out` in place; returns `out`.
 */
export const composeTransformInto = (
  out: Mat4,
  translation: Vec3,
  rotation: Quat,
  scale: Vec3,
): Mat4 => {
  // Start with the rotation matrix; fromQuat fills the upper-left 3x3 with R
  // and the bottom row with [0, 0, 0, 1].
  mat4.fromQuat(rotation, out);
  // Scale each column of the rotation by the per-axis scale factor.
  const sx = scale[0]!;
  const sy = scale[1]!;
  const sz = scale[2]!;
  out[0] = out[0]! * sx;
  out[1] = out[1]! * sx;
  out[2] = out[2]! * sx;
  out[4] = out[4]! * sy;
  out[5] = out[5]! * sy;
  out[6] = out[6]! * sy;
  out[8] = out[8]! * sz;
  out[9] = out[9]! * sz;
  out[10] = out[10]! * sz;
  // Translation row.
  out[12] = translation[0]!;
  out[13] = translation[1]!;
  out[14] = translation[2]!;
  return out;
};

// Scratch rotation matrix reused by `decomposeTransformInto`.
const decomposeRotScratch = mat4.identity();

/**
 * Decompose a column-major affine 4x4 matrix into translation, rotation, and
 * per-axis scale, writing each into the provided outputs. The inverse of
 * {@link composeTransformInto}.
 *
 * Scale is taken as the length of each basis column, with the X component
 * negated when the matrix has a negative determinant (a mirrored basis) so the
 * extracted rotation stays a proper rotation. A matrix combining non-uniform
 * scale with rotation in its parent chain can carry shear that no single TRS can
 * represent exactly; in that case the result is the nearest TRS (rotation taken
 * from the scale-normalized, orthonormalized basis).
 *
 * Pure translation/rotation/uniform-scale matrices round-trip exactly.
 */
export const decomposeTransformInto = (translation: Vec3, rotation: Quat, scale: Vec3, m: Mat4): void => {
  translation[0] = m[12]!;
  translation[1] = m[13]!;
  translation[2] = m[14]!;

  let sx = Math.hypot(m[0]!, m[1]!, m[2]!);
  const sy = Math.hypot(m[4]!, m[5]!, m[6]!);
  const sz = Math.hypot(m[8]!, m[9]!, m[10]!);
  const det =
    m[0]! * (m[5]! * m[10]! - m[6]! * m[9]!) -
    m[4]! * (m[1]! * m[10]! - m[2]! * m[9]!) +
    m[8]! * (m[1]! * m[6]! - m[2]! * m[5]!);
  if (det < 0) sx = -sx;
  scale[0] = sx;
  scale[1] = sy;
  scale[2] = sz;

  // Normalize each basis column to recover a pure rotation, guarding against a
  // zero-scale axis (a collapsed transform leaves that column at identity).
  const r = decomposeRotScratch;
  const ix = sx !== 0 ? 1 / sx : 0;
  const iy = sy !== 0 ? 1 / sy : 0;
  const iz = sz !== 0 ? 1 / sz : 0;
  r[0] = m[0]! * ix;
  r[1] = m[1]! * ix;
  r[2] = m[2]! * ix;
  r[4] = m[4]! * iy;
  r[5] = m[5]! * iy;
  r[6] = m[6]! * iy;
  r[8] = m[8]! * iz;
  r[9] = m[9]! * iz;
  r[10] = m[10]! * iz;
  quat.fromMat(r, rotation);
  quat.normalize(rotation, rotation);
};
