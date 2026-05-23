# ADR-0021: Visibility & CPU culling — three-component pipeline and VisibilitySystems set order

- **Status:** Accepted
- **Date:** 2026-05-23

## Context

ADR-0020 shipped per-camera dispatch and the `RenderLayers` component, but no system consumes the layer mask: every Render-set system runs against every camera, and `RenderLayers` exists only as a declared component. The renderer-roadmap Phase 3 closes this gap — it is the prerequisite for every downstream phase that draws entities (sprites in §8, meshes in §6, materials in §7), each of which assumes a per-entity `ViewVisibility` they can extract on and skip when culled.

Phase 3 also asks for the foundation primitives the renderer has been deferring:

- An axis-aligned bounding box (`Aabb`) attachable to entities to seed CPU culling.
- A per-camera `Frustum` derived each frame from the camera's view-projection.
- A three-component visibility pipeline (`Visibility` / `InheritedVisibility` / `ViewVisibility`) mirroring Bevy's, with hierarchical override semantics.
- A documented system order — `CalculateBounds → UpdateFrusta → VisibilityPropagate → CheckVisibility` — so later phases (mesh ingestion in particular) have a stable slot to register into.

ADR-0020 anticipated this work explicitly ("Phase 3 (visibility & culling) drops into place: `prepareCameras` already builds per-camera matrices; `CheckVisibility` writes `ViewVisibility` against the bitmask test"). This ADR seals the concrete shapes.

Out of scope for this ADR: GPU-side culling (deferred to Phase 13.3, behind compute-shader capability), occlusion culling (Phase 13.4), distance-based `VisibilityRange` (roadmap item 3.6 — see `docs/backlog/visibility-range.md`), and mesh-driven AABB auto-computation (the `CalculateBounds` slot is reserved but unfilled until Phase 6 lands).

## Decision

1. **`Aabb`, `Plane`, `Frustum` are math primitives in `@retro-engine/math`.** They are pure geometric types with no engine, ECS, or rendering dependency. `Aabb` is `{ center: Vec3, halfExtents: Vec3 }` — chosen over `{ min, max }` because plane-vs-box distance tests (the inner loop of `CheckVisibility`) read half-extents directly without per-call re-derivation. `Plane` stores `{ normal: Vec3, d: number }` and self-normalises in `setFromCoefficients`. `Frustum` carries six inward-facing `Plane`s in canonical order `[left, right, bottom, top, near, far]`, extracted via Gribb–Hartmann from a column-major view-projection matrix. The extraction targets WebGPU clip space (`z ∈ [0, 1]`) — the near plane is `row2` directly; the far plane is `row3 − row2`.

2. **The visibility pipeline is three components.** `Visibility`, `InheritedVisibility`, `ViewVisibility` live in `packages/engine/src/visibility/`. `Visibility.mode` is `'Inherited' | 'Hidden' | 'Visible'`; `InheritedVisibility.visible` is the resolved hierarchical boolean; `ViewVisibility.visible` is the per-frame aggregate written by culling. The three are chained via the engine's Required Components mechanism (`Visibility` requires `InheritedVisibility` requires `ViewVisibility`) so user code spawns just `new Visibility(...)` and the other two arrive automatically. `NoFrustumCulling` is a marker that short-circuits the frustum test for entities whose AABB would be a lie — particles, pre-skin skinned meshes, runtime-resized debug primitives.

3. **`ViewVisibility` is a boolean aggregate, not a per-camera bitset.** A renderable's `ViewVisibility.visible` is `true` iff at least one active camera passed both layer-mask and frustum tests this frame. Per-camera filtering (entity visible from camera A but not B) is a render-graph concern and lands when the render graph does in Phase 5; the data shape needed there will couple to whatever per-camera entity-indexing scheme the graph chooses (it almost certainly won't be `SortedCameras` index, which is unstable frame to frame). Extending `ViewVisibility` to carry per-camera state is additive; reordering or removing its current field is breaking and requires a new ADR.

4. **`Camera` requires `Frustum`.** Spawning a `Camera` (or a `Camera2d()` / `Camera3d()` bundle) auto-inserts a default `Frustum` via Required Components. `UpdateFrusta` refreshes each active camera's frustum in place from `Camera.computed.viewProjectionMatrix`. Inactive cameras keep their previous frustum — harmless because no system reads from an inactive camera's frustum.

5. **`VisibilitySystems` set order is documented, not a sub-set namespace.** The four-name pipeline `CalculateBounds → UpdateFrusta → VisibilityPropagate → CheckVisibility` is realised as three systems registered in `'postUpdate'` in that order, after `CameraPlugin`'s `Camera.computed` refresh. The engine's ordering primitive within a stage is *registration order* (transform propagation, then camera-computed, then visibility — each registered in sequence by `CorePlugin` and the plugins it adds). A `VisibilitySet`-style const namespace mirroring `RenderSet` is deferred: introducing sub-set ordering for any non-render stage is its own ADR and pays for itself only when a second consumer wants the same primitive. `CalculateBounds` is a reserved slot — Phase 6 (meshes) registers the auto-AABB system into it.

6. **`VisibilityPlugin` is framework-essential.** `CorePlugin` registers it immediately after `CameraPlugin`, so its three `'postUpdate'` systems fire after the camera plugin has written `Camera.computed.viewProjectionMatrix`. Every `App` gets the visibility pipeline at build time; opting out is not supported (renderable entities that do not want culling simply omit `Visibility` and their `ViewVisibility` stays at the default `false`, which downstream extract systems can interpret as "no culling info — draw always" if they choose).

7. **Hierarchical visibility propagation mirrors transform propagation's gating shape.** Same dirty-set sources — entities whose `Visibility` was `Changed`, entities whose `Parent` was `Changed`, entities whose `Parent` was just removed — and the same BFS-via-`Children` expansion to cover every descendant of every root that changed. Resolution: `'Hidden'` → false; `'Visible'` → true (overrides a hidden ancestor); `'Inherited'` (or no `Visibility` component) → parent's resolved value, defaulting to true at a root. Orphaned parents are treated as effective roots with a once-per-frame `devWarn`. Cycles break at the first re-visit with a once-per-frame `devWarn`. `InheritedVisibility` is `world.markChanged`-stamped only on real edges so `{ changed: [InheritedVisibility] }` filters fire on actual transitions.

8. **`CheckVisibility` is per-entity over all active cameras.** For each renderable (`InheritedVisibility` + `ViewVisibility`): if hierarchy hid it, write false and skip; otherwise iterate the pre-fetched active-camera array, layer-test, and either short-circuit (`NoFrustumCulling`, no `Aabb`, or no `GlobalTransform`) or run `Aabb.transform → frustumIntersectsAabb`. First passing camera flips `ViewVisibility.visible = true` and breaks. No cameras → every renderable's `ViewVisibility` is `false`.

Composition-only. `App` gains no new fields; `RenderContext` is unchanged; one new framework plugin registers three systems; `Camera` grows a `static requires`; new component classes (`Visibility`, `InheritedVisibility`, `ViewVisibility`, `NoFrustumCulling`) and new math primitives (`Aabb`, `Plane`, `Frustum`) ship under their natural homes. No abstract visibility base class, no plugin lifecycle changes, no scheduler primitives invented.

## Consequences

**Easier:**

- Sprite / mesh / material extract systems (Phases 6–8) become `Extract<Query>` plus a `ViewVisibility.visible` early-exit — no per-phase culling needs reinventing.
- Hierarchical hide/show is the natural API: a `'Hidden'` parent hides every `'Inherited'` descendant in one assignment; a `'Visible'` child of a `'Hidden'` parent is an intentional override the engine respects.
- `RenderLayers` (shipped in ADR-0020 but unused) gets its first consumer; the bitmask test runs inside `CheckVisibility` directly, no extra plumbing.
- Adding `NoFrustumCulling` to particle / skinned-mesh prefabs requires no code path changes once those phases land — the marker already short-circuits the right branch.
- Tests for the visibility pipeline run headless against `test-utils.ts`'s rendering renderer — no GPU, no real frustum extraction needed at the test layer beyond what the camera plugin already builds.

**Harder / accepted trade-offs:**

- **`CheckVisibility` is O(renderables × active-cameras) per frame.** For the v1 scenes this is fine; at scale (Phase 13's GPU-driven path) culling moves to a compute shader and this CPU system becomes a fallback for capability-gated paths. The current implementation pre-fetches active cameras into a flat array per frame so the renderable loop's inner work is cache-friendly, and short-circuits aggressively (layer test → `NoFrustumCulling` → no `Aabb` → no `GlobalTransform`) before touching frustum math.
- **`ViewVisibility` aggregate-boolean cannot express "visible only from camera A".** Multi-camera scenes where a renderable should be drawn in one pass but skipped in another need either a custom per-system filter (e.g. per-pipeline `RenderLayers` discipline) or a future per-camera bitset extension to `ViewVisibility`. The Phase 5 render-graph ADR is the natural place to fix this.
- **`Camera` now has a Required Component (`Frustum`).** Cameras spawned through any path — `new Camera(...)` direct, `Camera2d()` / `Camera3d()` bundle, render-world extract — auto-receive a `Frustum`. No test was counting components on cameras, so no breakage today, but anyone who *was* introspecting `Camera`-bearing entities for a "this entity has exactly these components" assertion will see the new `Frustum`.
- **Registration-order-as-ordering-primitive is fragile.** Reordering plugin registration in `CorePlugin` silently changes execution order. The engine catches this only with tests that assert end-state behaviour, not with a static schedule check. Promoting to a typed set primitive (analogous to `RenderSet`) is deferred until at least one other stage needs the same shape.
- **The `CalculateBounds` slot is named-but-empty until Phase 6.** A user who reads the visibility plugin expecting four registered systems sees only three. The TSDoc on `VisibilityPlugin` calls this out explicitly; no surprise once the doc is read, but it does mean the documented set order is partly aspirational in v1.
- **No `runIf` on visibility systems.** They run every `'postUpdate'` unconditionally. For a scene with zero renderables this is one query iteration each; cheap. If the engine ever sprouts a "no renderables this frame" condition, the visibility systems are obvious `runIf` candidates.

## Implementation

- `packages/math/src/aabb.ts` — `Aabb`, `Aabb.fromMinMax`, `Aabb.fromPoints`, `Aabb.transform`.
- `packages/math/src/plane.ts` — `Plane`, `Plane.setFromCoefficients`, `Plane.signedDistance`.
- `packages/math/src/frustum.ts` — `Frustum`, `Frustum.fromViewProj`, `frustumIntersectsAabb`.
- `packages/math/src/index.ts` — re-exports the three new modules.
- `packages/engine/src/visibility/visibility.ts` — `Visibility`, `InheritedVisibility`, `ViewVisibility`, `NoFrustumCulling`.
- `packages/engine/src/visibility/update-frusta.ts` — `updateFrustaSystem`.
- `packages/engine/src/visibility/visibility-propagate.ts` — `visibilityPropagateSystem`.
- `packages/engine/src/visibility/check-visibility.ts` — `checkVisibilitySystem`.
- `packages/engine/src/visibility/visibility-plugin.ts` — `VisibilityPlugin`.
- `packages/engine/src/visibility/index.ts` — visibility module re-exports.
- `packages/engine/src/camera/camera.ts` — `Camera.requires` declares `Frustum` as a required component.
- `packages/engine/src/core-plugin.ts` — `CorePlugin` registers `VisibilityPlugin` after `CameraPlugin`.
- `packages/engine/src/index.ts` — re-exports the visibility module.
- `packages/math/src/{aabb,frustum}.test.ts` and `packages/engine/src/visibility/{visibility-propagate,check-visibility}.test.ts` — primitive math, hierarchy resolution, and per-entity culling end-to-end against the headless rendering renderer.
