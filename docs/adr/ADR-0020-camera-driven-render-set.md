# ADR-0020: Camera-driven render set and per-view rendering

- **Status:** Accepted
- **Date:** 2026-05-23

## Context

ADR-0019 set up `App.renderWorld` and the six-set Render schedule, but assumed (and hardcoded) a single render pass per frame: `App.renderFrame()` opens one swapchain pass with the App-level `clearColor`, runs the entire `RenderSet.Render` set inside it, ends the pass, and submits. That shape is fine for "one triangle on the swapchain" — it does not survive contact with cameras.

Renderer-roadmap Phase 2 (Camera & view) requires:

- `Camera.target: RenderTarget` — a camera draws to a texture, a view, or the swapchain.
- `Camera.viewport` — sub-rect of its target.
- `Camera.clearColor: ClearColorConfig` — per-camera, with `Default | Custom | None` semantics.
- `SortedCameras` — multiple cameras per frame, ordered by `order`, with off-screen targets running before on-screen ones so their outputs can feed downstream cameras.
- `RenderLayers` — bitmask filter applied per-camera at visibility time (Phase 3 consumes this, Phase 2 ships the component).

Two cameras with different targets cannot share one render pass. The engine has to open a pass per active camera, in `SortedCameras` order, with that camera's clear config and viewport. The Render set therefore runs N times per frame, once per camera — not once.

This is the structural turn ADR-0019 explicitly anticipated ("Phase 2 (cameras) lands cleanly: ... a Render-set driver that walks the sorted phases.") The decision below makes the per-camera dispatch concrete and binds the conventions every later phase (materials, sprites, lights, render-graph) depends on.

## Decision

1. **The Render sub-set runs once per active camera per frame.** Between the `PhaseSort` and `Cleanup` sub-sets, `App.renderFrame()` iterates the `SortedCameras` resource. For each entry: resolve the target, open a render pass against the resolved view with the camera's `ClearColorConfig` and `Viewport`, pre-bind the camera's view bind group, run every system registered in `RenderSet.Render`, end the pass. After the loop, run `Cleanup` once. Active cameras = `Camera.isActive === true` with a resolved target.

2. **`SortedCameras` ordering rule.** Cameras sort by `Camera.order` ascending. Tie-breaker: off-screen targets (`{ kind: 'texture' }`, `{ kind: 'view' }`) run before on-screen targets (`{ kind: 'surface' }`, `{ kind: 'primary' }`) so their outputs are available as inputs to downstream cameras. Cameras whose target cannot be resolved (e.g. `{ kind: 'primary' }` on an App without a surface) are dropped with a one-shot dev warning.

3. **`RenderContext` carries the active camera.** A new `camera: CameraView` field exposes the per-pass view-projection matrix, view matrix, world position, target metadata (view, format, width, height), viewport rect, render-layer mask, and a `viewBindGroup` handle. Render-set systems read `ctx.camera.*` and bind their own resources against the convention below.

4. **View bind group is exposed, not pre-bound.** The engine allocates a per-camera `BindGroup` against a canonical view layout and writes a `ViewUniform` to its backing buffer each frame. The bind group is exposed via `RenderContext.camera.viewBindGroup`; render systems that want view data call `ctx.pass.setBindGroup(N, ctx.camera.viewBindGroup)` themselves and lay out their pipelines accordingly. The layout itself is exposed as a resource so material/mesh systems built on top can declare their pipelines against it. Phase 7 (Materials) will pin a stronger convention (`@group(0) = view` for the standard material protocol) once it has a concrete consumer; Phase 2 only ships the plumbing. The `ViewUniform` schema is fixed in this ADR and may extend additively (new trailing fields) in later phases; reordering or removing fields is breaking and requires a new ADR.

5. **`CameraRenderTarget` is an engine-level tagged union.** Defined in `@retro-engine/engine` (not `renderer-core`), it adds a fourth variant — `{ kind: 'primary' }` — to the three `RenderTarget` variants from ADR-0018. The camera plugin's prepare-cameras system translates `primary` to a `{ kind: 'surface' }` against `App.getSurface()` before calling `Renderer.resolveRenderTarget`. Keeps `renderer-core/RenderTarget` pure — the HAL has no notion of "App's primary surface."

6. **`CameraPlugin` is framework-essential.** `CorePlugin` registers it after `Time` and the transform propagation systems. Every `App` gets the camera systems (compute, extract, prepare, drive) and the `ClearColor` resource (default opaque black) inserted at build time. Apps that pre-insert a `ClearColor` are not overridden.

7. **`AppOptions.clearColor` is sugar for `ClearColor`.** At construction, if `options.clearColor` is set and the `ClearColor` resource is not yet present, the engine inserts `new ClearColor(options.clearColor)`. Existing callers (`apps/playground` and tests) work unchanged.

8. **No-camera fallback.** If `SortedCameras` is empty and a surface is present, `App.renderFrame()` opens one clear-only pass against the surface with the `ClearColor` resource and runs zero Render-set systems. Pre-pass sets (Extract/Prepare/Queue/PhaseSort) and post-pass set (Cleanup) still run normally. Preserves the "spin up an App without spawning a camera, see a cleared background" path; user render systems registered against `'render'` simply don't fire until a camera exists.

9. **Per-camera render systems opt in via `runIf`.** Phase 2 ships no per-camera filter on systems — every system in `RenderSet.Render` runs for every camera. Authors that want to skip cameras (e.g. a 2D-only sprite system on a 3D camera) declare a `runIf` that inspects the calling camera via a new `Camera` system param (resolves to `ctx.camera`) or via `RenderCtx.camera.*`. Cleaner filtering (camera-render-graph tagging, the Bevy `CameraRenderGraph(Core2d|Core3d)` pattern) lands when the render graph does, in Phase 5.

10. **`AddSystemOptions.set` defaulting unchanged.** Systems registered against `'render'` without an explicit `set` continue to default to `RenderSet.Render` (the ADR-0019 backwards-compat path) — they just now fire once per camera rather than once per frame.

Composition-only. `App` gains a per-frame camera iteration; `RenderContext` grows one field; a `CameraPlugin` registers systems; new component classes (`Camera`, projections, render-layers) and resources (`ClearColor`, `SortedCameras`) are added under `packages/engine/src/camera/`. No base camera class, no abstract view-uniform protocol, no plugin lifecycle changes.

## Consequences

**Easier:**

- Phase 3 (visibility & culling) drops into place: `prepareCameras` already builds per-camera `Frustum` from `viewProj`; `CheckVisibility` writes `ViewVisibility` against the bitmask test `(camera.layers & entity.layers) !== 0`.
- Phase 5 (render graph) absorbs the per-camera loop body without restructuring: the current "open pass → run Render set → end pass" lambda becomes the `CameraDriverNode`, and individual draw phases become graph nodes inside it.
- Phase 7 (materials) and Phase 6 (meshes) inherit the `@group(0)=view` convention for free. Their pipeline layouts include `view_bind_group_layout` as group 0; the engine binds it; material systems set `@group(1)`.
- Multi-target rendering (UI overlay cameras, minimaps, render-to-texture for post-processing handoffs) is a single new entity per camera — no engine code changes required.
- Test ergonomics: the `test-utils.ts` rendering renderer continues to work; new tests assert on the per-camera pass count by spawning multiple cameras and observing the mock encoder's `beginRenderPass` call count.

**Harder / accepted trade-offs:**

- **Render-set systems fire N times per frame.** A system that allocates per-frame state on each invocation now allocates N times if N cameras exist. Authors must keep render-set work idempotent per camera or guard with a `runIf`. The triangle plugin is naturally per-camera (it always draws into the active pass), so the backwards-compat path is clean.
- **No global bind-group reservation yet.** The engine does not pre-bind any group on the pass before render systems run. Render systems that want view data fetch it through `ctx.camera.viewBindGroup` and bind it explicitly. The playground triangle is unaffected — it keeps `@group(0)` for its color uniform. Phase 7 (Materials) is expected to pin "view = group 0" as a hard convention; Phase 2 keeps the door open.
- **`ViewUniform` schema is engine-fixed.** Per phase 6+ materials, this is the point users sample camera state. Extending it costs a buffer-size bump and a pre-bind-group rebuild — additive. Reordering or removing fields is a new ADR.
- **Cross-world commands gap unchanged.** Render-stage `cmd.spawn(...)` still flushes to `app.world`; the camera plugin's extract system writes to `app.renderWorld` directly with `app.renderWorld.spawn(...)`. Same shape as ADR-0019. Adopting a future cross-world commands API is straightforward.
- **`AppOptions.clearColor` becomes deprecated.** It still works (translated to a `ClearColor` resource at construction), but the resource is the canonical path. The option's docstring directs new code to `insertResource(new ClearColor(...))`. Removal is a future major-version concern.
- **Empty-cameras "fallback clear" is a special case.** It's deliberately one extra branch in `renderFrame` to keep the "spin up an App, see a cleared canvas" path alive. Once `Camera2d` / `Camera3d` are routinely spawned at startup (as they are in `apps/playground` after this PR), the fallback path is rarely hit; it can be removed if it stops paying its way.

## Implementation

- `packages/engine/src/camera/camera.ts` — `Camera`, `Viewport`, `ClearColorConfig`, `CameraRenderTarget`, `ComputedCamera`, `CameraView`.
- `packages/engine/src/camera/projection.ts` — `PerspectiveProjection`, `OrthographicProjection`, `ScalingMode`, projection-matrix builders.
- `packages/engine/src/camera/render-layers.ts` — `RenderLayers` component, `renderLayersIntersect`.
- `packages/engine/src/camera/clear-color.ts` — `ClearColor` resource.
- `packages/engine/src/camera/sorted-cameras.ts` — `SortedCameras` resource, ordering rule.
- `packages/engine/src/camera/camera-bundles.ts` — `Camera2d`, `Camera3d` factory functions.
- `packages/engine/src/camera/extracted.ts` — render-world component classes (`ExtractedCamera`, `ViewUniformGpu`) and view-bind-group cache resource.
- `packages/engine/src/camera/camera-plugin.ts` — `CameraPlugin` registering camera/extract/prepare systems.
- `packages/engine/src/system-param.ts` — extend `RenderContext` with `camera: CameraView`; add `Camera` system param.
- `packages/engine/src/index.ts` — `App.renderFrame()` rewritten around per-camera dispatch; `AppOptions.clearColor` translates to a `ClearColor` resource; re-export camera surface.
- `packages/engine/src/core-plugin.ts` — register `CameraPlugin`.
- `packages/engine/src/camera/*.test.ts` and `packages/engine/src/camera-render.test.ts` — projection math, render-layers intersect, sort rule, multi-camera frame dispatch.
- `apps/playground/src/triangle-plugin.ts` — spawn `Camera2d()` at startup.
