---
'@retro-engine/engine': minor
---

feat(engine): cameras, projections, render layers, and camera-driven render set (Renderer Phase 2)

First real consumer of the render world and `RenderTarget`. Per ADR-0020, the `Render` sub-set of the `'render'` stage now runs once per active camera per frame, with a render pass opened per camera against its resolved target, viewport, and clear-config. `SortedCameras` orders cameras by `Camera.order` (off-screen targets first on ties).

**Components & resources (`packages/engine/src/camera/`):**

- `Camera` — `isActive`, `order`, `viewport`, `target: CameraRenderTarget`, `hdr`, `msaaWriteback`, `clearColor: ClearColorConfig`, `computed: ComputedCamera`.
- `PerspectiveProjection` / `OrthographicProjection` — separate component classes; both updated each frame by the engine's camera system. `ScalingMode` union (`WindowSize` | `Fixed` | `AutoMin` | `AutoMax` | `FixedVertical` | `FixedHorizontal`) drives orthographic sizing.
- `RenderLayers` — 32-bit bitmask component, default `0b1`. `renderLayersIntersect(a, b)` helper. The visibility *check* is wired in the next phase (Visibility & CPU culling); this phase ships the component so cameras and renderables can declare layers up-front.
- `ClearColor` — global default color resource. Cameras with `ClearColorConfig.Default` read it; `Custom(color)` overrides; `None` skips the clear.
- `CameraRenderTarget` — engine-level tagged union (`primary` | `surface` | `texture` | `view`). `Primary` is the default target and resolves to the App's surface at frame time; render targets that fail to resolve (e.g. primary on a headless App) are dropped with a one-shot warning.
- `SortedCameras` — per-frame resource holding the dispatch order.
- `ViewBindGroupCache` — internal resource caching the per-camera view bind group + uniform buffer.
- `VIEW_UNIFORM_WGSL` / `VIEW_UNIFORM_BYTE_SIZE` — WGSL snippet + struct size for the canonical view uniform (`view_proj`, `view`, `inverse_view`, `projection`, `world_position`, `viewport`).

**Bundles:**

- `Camera2d()` / `Camera3d()` — factory functions returning `[Camera, Projection, Transform]` tuples ready to pass to `spawn(...)`. `Camera2d` uses `near=-1000` so 2D entities at negative Z stay visible.

**Engine wiring:**

- `App.renderFrame()` rewritten around per-camera dispatch. The Render set runs once per active camera in `SortedCameras` order with the camera's pass open; no-camera Apps with a surface get one fallback clear-only pass, headless apps with no cameras do no GPU work.
- `RenderContext.camera: CameraView` — per-pass view exposing the resolved render target, view/projection matrices, viewport, render-layer mask, world position, and the per-camera view bind group.
- `AppOptions.clearColor` is now sugar for inserting a `ClearColor` resource; the resource is the canonical path.
- `CameraPlugin` is auto-installed by `CorePlugin`. It registers `cameraSystem` in `'postUpdate'`, `extractCameras` in `RenderSet.Extract`, and `prepareCameras` in `RenderSet.Prepare`.

**Behaviour notes:**

- Render-stage systems registered against the default `RenderSet.Render` now fire once per camera per frame. With one camera, behaviour matches the previous single-pass shape.
- `apps/playground` spawns a `Camera2d` at startup; existing render-stage tests were updated to do the same. Apps that never spawn a camera fall back to a clear-only pass.
- The view bind group is exposed via `ctx.camera.viewBindGroup` but the engine does **not** pre-bind it on the pass. Render systems that want view data set it themselves; Phase 7 (Materials) will pin the `group(0) = view` convention when it has a concrete consumer.
