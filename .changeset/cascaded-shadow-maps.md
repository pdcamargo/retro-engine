---
'@retro-engine/engine': minor
---

feat(engine): Phase 10.5 — cascaded shadow maps for directional lights

Per ADR-0046, extends ADR-0045's directional/spot shadow maps with **cascaded shadow maps** for directional lights. The camera's view frustum is split into depth slices ("cascades"); each is fit with its own camera-tracking light-space projection and rendered into its own atlas layer, and `pbr.wgsl` selects the cascade per fragment by view-space depth. This removes ADR-0045's fixed origin-centered shadow box: directional shadows now follow the camera and stay crisp from up close out to the shadow draw distance. Spot lights, point lights, and the unlit path are unaffected. No new HAL, no GPU capability flag.

Directional lights gain cascades automatically — a `CascadeShadowConfig` is auto-inserted on every `DirectionalLight3d`. When no perspective camera drives the scene, directionals fall back to ADR-0045's fixed orthographic box.

**New public surface:**

- `CascadeShadowConfig` — per-light component (auto-inserted on `DirectionalLight3d`) configuring its cascaded shadow: `numCascades` (clamped to `[1, MAX_CASCADES]`), `minimumDistance` / `maximumDistance` (the cascaded shadow range in view-space distance), `firstCascadeFarBound`, `overlapProportion` (cascade blend band), `lambda` (uniform↔logarithmic split blend). `CascadeShadowConfigOptions` is the constructor input shape.
- `MAX_CASCADES` (4) — maximum cascades per directional light (one `vec4` of split distances).
- `computeCascadeSplits`, `cascadeLightViewProj`, `reserveCasterLayers` (+ `CascadeFitParams`) — pure cascade split + stabilized light-space-fit + layer-reservation helpers (exposed for tests / benches / custom plugins).
- `packCascadeSplits`, `packDirectionalCascadeBase` — pure packers for the new `GpuLights` cascade metadata.

**Behaviour changes:**

- `GpuLights` grew: the uniform buffer is now 8112 B (was 7840), adding a `cascade_splits: vec4<f32>` (per-cascade far view-depths) and growing `shadow_view_proj` from 8 to 12 matrices. `counts.w` (previously unused) now carries the cascade count; a shadowed directional stores its **base** atlas layer in `direction.w` (cascade `c` uses layer `base + c`). `packCounts` gained an optional trailing `cascadeCount` argument. The `@group(2)` layout is unchanged (three bindings) — only the uniform's size.
- `MAX_SHADOW_CASTERS` grew 8 → 12 so a cascaded sun (up to 4 layers) does not starve spot shadows. The atlas is ~48 MB at defaults (`SHADOW_MAP_SIZE` / `MAX_SHADOW_CASTERS` remain tunable).
- `DirectionalLight3d.requires` now includes `CascadeShadowConfig`.
- `Shadow3dSettings` gained `cascadeBackExtension` (depth pulled toward the light per cascade to catch occluders just outside the slice); `directionalExtent` is now the no-perspective-camera fallback box.
- `Light3dPlugin`'s `light3d-prepare` now reads the active `Core3d` perspective camera (extracted from the main world) to fit cascades. Cascade splits are shared across directionals (a camera function); per-light split ranges, multi-camera fitting, per-cascade caster culling, and per-cascade bias are documented follow-ons.
