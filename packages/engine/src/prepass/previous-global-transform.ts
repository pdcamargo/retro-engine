import type { Mat4 } from '@retro-engine/math';
import { mat4 } from '@retro-engine/math';

/**
 * Per-entity snapshot of last frame's {@link GlobalTransform.matrix}. Read by
 * the motion-vector prepass vertex stage to reproject each vertex's previous
 * world position into the previous frame's clip space, which feeds the
 * screen-space motion-vector output.
 *
 * Auto-inserted by `PrepassPlugin` on any entity that gains a `Mesh3d`
 * component (motion vectors are a 3D-renderable concern), seeded from the
 * entity's current `GlobalTransform`. Propagated each frame in `'last'` by
 * `propagatePreviousTransforms` — that system copies the current
 * `GlobalTransform.matrix` into the `previous` slot **after** all gameplay
 * has settled, so frame N's `GlobalTransform` becomes frame N+1's
 * `PreviousGlobalTransform`.
 *
 * First-frame correctness: because the component is seeded to the current
 * matrix at insertion time, the prepass shader naturally produces a zero
 * motion vector on the entity's first rendered frame — no special-case
 * branch needed.
 *
 * The matrix is stable storage: the propagation system writes into the same
 * `Float32Array` each frame so consumers can cache the reference.
 */
export class PreviousGlobalTransform {
  /**
   * Column-major 4x4 world matrix as observed at the end of the previous
   * frame. Identity until the first propagation pass runs.
   */
  readonly matrix: Mat4 = mat4.identity();
}

