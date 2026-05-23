/**
 * Per-frame "is this entity drawn for any active camera" flag. Written by
 * the `checkVisibility` system after running every renderable through the
 * camera-frustum + render-layer tests. Default is `false` — entities are
 * culled until visibility is computed for them at least once.
 *
 * Downstream rendering systems (sprite, mesh, custom material extract /
 * queue) read this and skip entities where `visible` is `false`. The flag
 * is an aggregate across all active cameras this frame; per-camera
 * filtering is the render-graph's concern in a later phase.
 */
export class ViewVisibility {
  visible: boolean;

  constructor(visible: boolean = false) {
    this.visible = visible;
  }
}

/**
 * Resolved hierarchical visibility for the current frame, written by the
 * `visibilityPropagate` system from each entity's {@link Visibility.mode}
 * walked against its parent's resolved state. Read by `checkVisibility` to
 * short-circuit hidden subtrees before any per-camera work runs, and by
 * downstream gameplay/extract systems that want a single "is this drawable
 * at all" boolean.
 *
 * Do not write from gameplay code — set {@link Visibility.mode} and let
 * propagation drive this.
 */
export class InheritedVisibility {
  visible: boolean;

  constructor(visible: boolean = true) {
    this.visible = visible;
  }

  static readonly requires = [ViewVisibility];
}

/**
 * Per-entity visibility intent. Defaults to `'Inherited'` — let the parent
 * decide; root entities resolve to visible.
 *
 * The three modes form a small override lattice walked once per
 * `'postUpdate'` to produce {@link InheritedVisibility}:
 *
 * - `'Inherited'` → resolves to the parent's effective visibility, or
 *   visible at a root.
 * - `'Hidden'` → resolves to hidden; descendants with
 *   `'Inherited'` inherit the hidden state.
 * - `'Visible'` → resolves to visible; overrides a hidden ancestor, so a
 *   `'Visible'` child of a `'Hidden'` parent is still drawn.
 *
 * Mutate `mode` directly from gameplay code; the propagation pass picks it
 * up next frame.
 */
export class Visibility {
  mode: 'Inherited' | 'Hidden' | 'Visible';

  constructor(mode: 'Inherited' | 'Hidden' | 'Visible' = 'Inherited') {
    this.mode = mode;
  }

  static readonly requires = [InheritedVisibility];
}

/**
 * Marker attached to renderable entities whose local-space AABB is unreliable
 * or unavailable — skinned meshes before skinning, particle systems whose
 * bounds expand at runtime, procedurally-sized debug primitives. The presence
 * of this component short-circuits the frustum test in `checkVisibility`,
 * making the entity visible to every camera whose render layers intersect.
 *
 * Hierarchical and layer-mask gating still apply — `NoFrustumCulling` is an
 * escape from *frustum* culling specifically, not from visibility at large.
 */
export class NoFrustumCulling {}
