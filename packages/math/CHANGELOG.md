# @retro-engine/math

## 0.1.0

### Minor Changes

- fad8a5e: feat: gizmos + debug-draw system and editor transform gizmos (ADR-0075)

  An engine-level, immediate-mode, world-space `Gizmos` debug-draw API rendered through a dedicated line pass, plus editor transform gizmos built on top of it. The gizmo pass renders into both `Core2d` and `Core3d`, after the transparent/post passes and before tonemapping, and gates each draw by the camera's render layers — a reserved `EDITOR_GIZMO_LAYER` keeps editor-only visuals out of the game view. This is the documented, scalable pattern for separating editor visuals from game visuals; the debug-draw API itself is exposable to user game code.

  **`@retro-engine/math`** — new geometry primitives for picking and gizmo math, projection-agnostic (correct under perspective and orthographic):

  - `Ray` + `Ray.fromScreen` (NDC → world ray unprojection, WebGPU `[0,1]` depth).
  - `rayPlaneIntersect`, `rayClosestPointToRay`, `signedAngleOnPlane`.
  - `screenSpaceScale` — world length that subtends a target pixel size, for constant-on-screen gizmo sizing.

  **`@retro-engine/engine`** — immediate-mode gizmo rendering:

  - `Gizmos` resource with `line` / `lineGradient` / `ray` / `circle` / `arc` / `sphere` / `cuboid` / `arrow` / `axes` / `grid`, each tagged with a render-layer mask and depth-test flag, cleared per frame.
  - `GizmoPlugin` (auto-added by `CorePlugin`), the `Core2d`/`Core3d` line pass, and `EDITOR_GIZMO_LAYER` / `EDITOR_GIZMO_MASK` for editor-only visuals.

  **`@retro-engine/editor-sdk`** — `TransformGizmo`: interactive Move / Rotate / Scale / All handles in 2D and 3D, editing one or more targets about their shared centroid, with constant on-screen sizing, a live drag readout (delta / angle / factor), and Escape-to-cancel.

- f8079c6: feat(math): add `rayAabbIntersect` for ray-vs-box queries

  Slab-method intersection between a `Ray` and an `Aabb`. Returns the entry distance `t` along the ray (a true Euclidean distance, since `Ray.direction` is unit length) or `null` on a miss; a ray originating inside the box returns `0`, and a box entirely behind the origin returns `null`. Directly comparable across boxes for nearest-hit picking.

- 5cf81f9: feat(engine): visibility & CPU culling — three-component pipeline + Aabb/Frustum (Renderer Phase 3)

  First consumer of the `RenderLayers` mask shipped in Phase 2. Per ADR-0021, every `App` now runs a hierarchical visibility resolution and per-camera frustum-and-layer cull in `'postUpdate'`, writing each renderable entity's `ViewVisibility.visible` boolean for downstream phases to gate on.

  **Math primitives (`packages/math/src/`):**

  - `Aabb` — `{ center, halfExtents }` axis-aligned bounding box. Static factories `fromMinMax`, `fromPoints`, `transform` (writes the world-space AABB of a local-space box under a column-major 4×4).
  - `Plane` — `{ normal, d }` with `setFromCoefficients` (self-normalises) and `signedDistance(point)`.
  - `Frustum` — six inward-facing planes in canonical order `[left, right, bottom, top, near, far]`. `Frustum.fromViewProj(viewProj, dst?)` extracts via Gribb–Hartmann from a column-major view-projection matrix; WebGPU clip-space convention (`z ∈ [0, 1]`). `frustumIntersectsAabb(frustum, aabbWorld)` runs the positive-vertex test against a _world-space_ AABB.

  **Components (`packages/engine/src/visibility/`):**

  - `Visibility` — `mode: 'Inherited' | 'Hidden' | 'Visible'`, default `'Inherited'`. Required Components chains to `InheritedVisibility` and `ViewVisibility` automatically.
  - `InheritedVisibility` — `visible: boolean`. Resolved per frame from the `Visibility` hierarchy walk: `'Hidden'` → false; `'Visible'` → true (overrides hidden ancestor); `'Inherited'` → parent's value or true at a root.
  - `ViewVisibility` — `visible: boolean`. Per-frame aggregate: true iff at least one active camera passed both layer-mask and frustum-vs-AABB tests.
  - `NoFrustumCulling` — marker that short-circuits the frustum test (still respects hierarchy and render layers). Use for entities whose AABB is unreliable — particles, pre-skin skinned meshes, runtime-resized debug primitives.

  **Engine wiring:**

  - `Camera` declares `static requires = [Frustum]` — every camera auto-receives a `Frustum` component on spawn.
  - `VisibilityPlugin` is auto-installed by `CorePlugin` after `CameraPlugin`. It registers three `'postUpdate'` systems in the documented `VisibilitySystems` order: `updateFrustaSystem` → `visibilityPropagateSystem` → `checkVisibilitySystem`. The `CalculateBounds` slot is reserved for Phase 6 (mesh AABB auto-build) and registers no system yet.

  **Behaviour notes:**

  - Entities without `Visibility` are not iterated by the visibility pipeline at all — Required Components is opt-in via `new Visibility(...)`. Renderables that opt in but lack an `Aabb` or `GlobalTransform` are treated as always-visible (no culling possible).
  - `ViewVisibility` is a boolean aggregate across all active cameras. Per-camera filtering (visible from camera A but not B) will land alongside the render graph in Phase 5; the current shape can be extended additively without breaking consumers.
  - Hierarchical propagation reuses the same dirty-set + BFS-via-`Children` gating as transform propagation — orphan-parent and cycle handling produce a once-per-frame `devWarn` per offending entity.
  - The playground triangle is unaffected — it spawns no `Visibility` component, so the visibility pipeline ignores it and it renders unchanged.
