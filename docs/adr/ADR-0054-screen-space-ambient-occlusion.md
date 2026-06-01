# ADR-0054: screen-space ambient occlusion — a pre-opaque GTAO pass feeding the forward ambient term

- **Status:** Accepted
- **Date:** 2026-05-31

## Context

The depth + normal prepass ([ADR-0050](ADR-0050-screen-space-prepass-family.md)) shipped a
device-verified world-space normal target that, until now, had no consumer — motion blur
([ADR-0052](ADR-0052-screen-space-motion-blur.md)) and TAA
([ADR-0053](ADR-0053-temporal-anti-aliasing.md)) read only the motion target. Ambient occlusion
is that consumer: it reads depth + normal, estimates how much of each pixel's hemisphere is
blocked by nearby geometry, and darkens the **ambient / indirect** lighting term in creases and
contact points the analytic lights leave flat (the placeholder constant ambient of
[ADR-0044](ADR-0044-3d-analytic-lights-and-forward-shading.md)).

Two constraints shaped the design:

- **This is a forward renderer.** The ambient term is composited *inside* the PBR fragment
  shader (`pbr.wgsl` `fs_main`: `ambient = lights.ambient.rgb * lights.ambient.a * base_color.rgb
  * occlusion`). AO therefore cannot be a post-process that darkens the final HDR image — that
  would wrongly darken direct light too. AO must run **before** the opaque pass, write an
  occlusion texture, and the forward shader must sample it and multiply only that ambient term.

- **Depth is written jittered.** ADR-0053 bakes the TAA sub-pixel offset into the shared
  `view_proj`, so the depth prepass rasterizes jittered geometry while the view uniform's
  standalone `projection` / `inverse_view` stay unjittered. ADR-0053 flagged this as a latent
  trap for "a future SSAO/SSR consumer that reconstructs view-space position from depth." This is
  that consumer.

## Decision

Add a per-camera `ScreenSpaceAo` component and a pre-opaque full-screen GTAO pass ordered
`Prepass → AO → Opaque`.

- **GTAO, fragment-only.** A horizon-search visibility estimate (the GTAO / HBAO family) over a
  few rotated slices, in a single fragment pass. No compute or storage-texture dependency, so it
  is reachable on WebGL2; a compute-shader speedup is deferred and would gate behind a
  `RendererCapabilities` flag. Depth and normal are read with `textureLoad` at integer texel
  coordinates (no sampler), which sidesteps depth-format filterability limits and keeps every tap
  on uniform control flow.

- **Exact reconstruction under jitter, via the AO pass's own params buffer.** View-space position
  is reconstructed by inverting the **jittered** projection — the matrix the depth was actually
  rasterized with — so the reconstruction is geometrically exact, jittered or not. The jittered
  inverse-projection is computed on the CPU per AO-enabled camera (re-baking the same
  `ViewJitter` offset the camera folded into `view_proj`, then inverting) and uploaded in the AO
  params uniform. The shared 416-byte view uniform is left untouched — cameras without AO pay
  nothing, and the same pattern serves a future SSR consumer.

- **Forward feedback through a `@group(3)` AO read binding.** The opaque pipeline gains an
  AO-enabled variant for lit materials that declare `static usesAo`: `MaterialPlugin` appends the
  AO read bind-group layout (sampler + `texture_2d<f32>`) at `@group(3)` and compiles the
  `ENABLE_SSAO` fragment variant. `OpaquePass3dNode` binds the camera's AO texture at `@group(3)`
  for the whole pass; pipelines that don't declare the group ignore it (the same contract as the
  `@group(2)` lights binding). The pipeline key carries a stable `aoEnabled` boolean (never a
  class name) so the AO and non-AO variants never share a cache entry and the keying survives
  bundler minification. This lands the deferred `@group(3)` binding
  (`docs/backlog/prepass-readable-binding.md`) — but carrying the derived AO texture, not the
  prepass normal/motion the backlog originally scoped (no forward consumer needs those; they are
  read in standalone passes).

- **AO is pre-opaque, not HDR-space.** It does not require `Camera.hdr` and is not part of the
  `CurrentHdrView` post chain. It requires a `DepthPrepass` + `NormalPrepass`; when either is
  absent the prepare system skips allocation (warning once) and the camera shades with a flat
  ambient term — the same warn-once-and-skip contract as motion blur / TAA.

- **Denoise: bilateral blur + temporal accumulation.** AO is noisy, so the raw GTAO output is
  denoised by a depth/normal-aware bilateral blur and a motion-vector-reprojected temporal
  accumulation (mirroring the TAA history ping-pong), landed as incremental device-verifiable
  slices. The opaque pass always samples the per-camera *final* AO view, so adding denoise stages
  repoints that view without changing the forward-feedback wiring.

- **`view-depth` is allocated sampleable.** The auto depth texture gains `TEXTURE_BINDING`
  (additive; the attachment usage is unchanged) so screen-space passes can read it. A new
  `r8unorm` single-channel format was added to the HAL for the AO target.

## Consequences

- One extra full-screen pass (plus the denoise passes) and a per-camera `r8unorm` AO target +
  history, allocated only for AO cameras; the GTAO fragment cost is the horizon-search loop.
- Lit AO-enabled materials fork one extra opaque pipeline variant (extra `@group(3)` layout +
  `ENABLE_SSAO` define); non-AO cameras and unlit/transparent materials are untouched.
- The forward `fs_main` change is `#ifdef`-gated, so the non-AO pipeline variant is byte-identical
  to before — zero risk to existing scenes.
- Reconstruction is exact even under TAA jitter; the cost is one CPU `mat4` inverse per AO camera
  per frame, kept out of the shared view uniform.
- AO is 3D-only (it needs the depth + normal prepass), like motion blur and TAA — no Core2d
  variant.
- The depth texture is now always sampleable; AO can be combined with TAA (jitter dithers the AO
  sampling, which the temporal accumulation integrates).

## Implementation

- `packages/engine/src/ao/ao.ts` — `ScreenSpaceAo`, `DEFAULT_AO`
- `packages/engine/src/ao/ao.wgsl.ts` — `AO_GTAO_WGSL` (`retro_engine::ao_gtao`)
- `packages/engine/src/ao/ao-pipeline.ts` — `AoPipeline`, `AoKey`
- `packages/engine/src/ao/ao-bind-group-cache.ts` — `AoBindGroupCache` (the `@group(3)` read layout + per-camera bind group)
- `packages/engine/src/ao/ao-node.ts` — `makeAoGtaoNode`, `AoGtaoPass3dLabel`
- `packages/engine/src/ao/view-ao.ts` — `ViewAo`, `AoParams`
- `packages/engine/src/ao/view-ao-targets.ts` — `ViewAoTargets`, `AoCacheEntry`, `AO_TARGET_FORMAT`, `AO_PARAMS_BYTE_SIZE`, `resolveAoTargets`, `evictAoTargets`
- `packages/engine/src/ao/ao-plugin.ts` — `AoPlugin` (extract + prepare with the jittered-inverse reconstruction, graph wiring `Prepass → AO → Opaque`)
- `packages/engine/src/material/material.ts` — `MaterialPipelineKey.aoEnabled`
- `packages/engine/src/material/material-plugin.ts` — `MaterialCtor.usesAo`, the `aoEnabled` opaque pipeline variant (`@group(3)` layout + `ENABLE_SSAO` fragment module) and per-camera selection
- `packages/engine/src/material/pbr.wgsl.ts` — `#ifdef ENABLE_SSAO` `@group(3)` AO sampling folded into the ambient term
- `packages/engine/src/material/standard-material.ts` — `StandardMaterial.usesAo`
- `packages/engine/src/render-graph/opaque-pass-3d-node.ts` — `setBindGroup(3, …)` from `AoBindGroupCache`
- `packages/engine/src/camera/camera-plugin.ts` — `view-depth` allocated `RENDER_ATTACHMENT | TEXTURE_BINDING`
- `packages/renderer-core/src/formats.ts` — `r8unorm` in `TextureFormat`
- `packages/engine/src/core-plugin.ts` — auto-installs `AoPlugin`
- `packages/engine/src/index.ts` — re-exports the public surface above
- `packages/engine/bench/ao.bench.ts` — per-frame dispatch cost, AO on vs off
- `apps/playground/src/ao-showcase-plugin.ts` — `?mode=ao` device-verification harness
