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
 *
 * @internal Engine-private helper used by `propagateTransforms`.
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
