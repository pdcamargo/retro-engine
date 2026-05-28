---
'@retro-engine/engine': minor
---

feat(engine): Phase 12.1/12.2 — HDR per-camera + tonemapping

Per ADR-0048, opens the post-processing chain. `Camera.hdr = true` now drives a per-camera `rgba16float` intermediate render target; a new `Tonemapping` per-camera component selects the display transform on the way to the camera's actual output. Geometry, transparent, and 2D light-composite passes write to `CameraView.mainColorTarget` (the HDR intermediate when `hdr = true`, or the camera's existing target when `hdr = false`); the new `TonemappingNode` appended to both `Core2d` and `Core3d` sub-graphs reads the HDR intermediate and writes the camera's final target. Material2d / Material3d / Sprite / 2D-light-composite pipeline keys now specialize on `view.mainColorTarget.format`, so the existing `PipelineCache` automatically specializes pipelines by `bgra8unorm` vs `rgba16float`. No new HAL, no new capability flag.

**New public surface:**

- `Tonemapping` (component) — `method: TonemappingMethod`.
- `TonemappingMethod` — string-literal union: `'none' | 'reinhard' | 'reinhard_luminance' | 'aces_fitted' | 'agx' | 'blender_filmic' | 'somewhat_boring_display_transform'`.
- `TONEMAPPING_METHODS` — frozen list of operator names.
- `TonemappingPlugin` — auto-installed by `CorePlugin`; inserts the pipeline + node into both sub-graphs.
- `CameraView.mainColorTarget: ResolvedRenderTarget` + `CameraView.hdr: boolean` — new fields. `mainColorTarget === target` for non-HDR cameras; for HDR cameras it points at a per-camera `rgba16float` intermediate.
- `Camera2d({ hdr, tonemapping? })` / `Camera3d({ hdr, tonemapping? })` — bundle factories grow a `tonemapping?: TonemappingMethod` option; insert `Tonemapping({ method: 'agx' })` by default when `hdr: true` and no override is passed.

**Behaviour changes:**

- Cameras with `hdr: true` now allocate a per-camera `rgba16float` texture in `RenderSet.Prepare` (cached in a new `ViewHdrTargets` resource, GC'd at frame end like `ViewDepthCache`). Memory cost: one `width × height × 8 B` texture per HDR camera, returned when `hdr` flips back to `false`.
- All geometry / composite pass nodes (`OpaquePass2dNode`, `TransparentPass2dNode`, `OpaquePass3dNode`, `TransparentPass3dNode`, `Light2dCompositePass2dNode`) write to `view.mainColorTarget.view` instead of `view.target.view`. For non-HDR cameras this is the same object reference — zero behavioural change.
- The 2D `baseColor` intermediate (`ViewLight2dTargets.baseColorTex`) now follows `view.mainColorTarget.format`: `rgba16float` when HDR is on, otherwise the swapchain format (same as before). This preserves HDR values from the geometry passes into the light composite.
- Material2d's pipeline key now reads `hdr` from `view.hdr` (previously hardcoded `false`); Material3d and Sprite specialization keys gain an `hdr: boolean` slot. The `PipelineCache` already hashes on color-target format, so pipelines automatically specialize without any cache change.

**Out of scope (tracked):**

- `tony_mc_mapface` operator — backlogged in `docs/backlog/tonemapping-tony-mcmapface.md`, gated on the asset system for HDR LUT loading.
- MSAA × HDR — Phase 12.3.
- Multi-pass post-processing chain (`main_texture` / `out_texture` ping-pong) — the trigger is Phase 12.4 (bloom).
- `ColorGrading` (pre-tonemap exposure / contrast / saturation / gamma) — separate follow-on.
