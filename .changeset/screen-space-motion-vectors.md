---
'@retro-engine/engine': minor
'@retro-engine/renderer-core': minor
---

feat(engine): screen-space motion vectors — per-entity previous-instance buffer + fs_prepass_motion (ADR-0051)

Activates the ADR-0050 motion-vector substrate. Cameras carrying `MotionVectorPrepass` now produce a per-pixel `rg16float` screen-space motion-vector target alongside the existing depth and normal targets. Unblocks Phase 12.6 TAA (the first consumer) and the motion-vector half of 12.10 motion blur.

**New public surface:**

- `PREVIOUS_INSTANCE_LAYOUT`, `PREVIOUS_INSTANCE_BYTE_SIZE`, `PREVIOUS_INSTANCE_FLOAT_COUNT`, `PREVIOUS_INSTANCE_TRANSFORM_BASE_LOCATION`, `packPreviousInstanceTransform` — per-instance vertex layout + packer for the previous-frame model matrix. Stride 64 bytes, four `float32x4` columns at `@location(16..19)`, `stepMode: 'instance'`.
- `MeshPreviousInstanceBuffer` — sibling of `MeshInstanceBuffer` carrying the per-entity previous-frame model matrix. Lazily allocated on the first frame a motion-enabled camera asks for it; mirrors the 1.5× growth + deferred-destroy lifecycle.
- `INSTANCE_LAYOUT`, `MESH_INSTANCE_BYTE_SIZE`, `MESH_INSTANCE_FLOAT_COUNT`, `packInstanceTransform` — promoted from internal to the engine's public surface alongside the new previous-instance peers.
- `'rg16float'` added to `@retro-engine/renderer-core`'s `TextureFormat` union (additive — the WebGPU backend passes the string through unmodified; existing consumers unaffected). `bytesPerTexel` returns 4.

**Behaviour changes:**

- `PREPASS_MOTION_VECTOR_FORMAT` narrows from the `'rgba16float'` placeholder to `'rg16float'` — half the bandwidth of the placeholder.
- `MotionVectorPrepass` is no longer masked off in `PrepassPlugin`'s Extract — the marker now sets `flags.motionVector` to true alongside `DepthPrepass` and `NormalPrepass`. The one-shot `warnedMotionDeferred` dev-warn is removed.
- `StandardMaterial.prepassWrites().motionVector` flips from `false` to `true`. `UnlitMaterial` stays depth-only (no normal data, no motion participation).
- `pbr.wgsl` gains `fs_prepass_motion` (motion-only fragment, single `rg16float` target) and `fs_prepass_normal_motion` (combined normal + motion fragment, two targets in one fragment — keeps cardinality at one prepass pipeline per opt-in material per flag combination). Both entries are conditionally compiled under a new `#ifdef PREPASS_MOTION_VECTOR` define the material plugin sets per-variant.
- `InstancedDrawPayload` gains an optional `previousInstanceBuffer?: Buffer` field; `makeInstancedDraw` binds it at vertex slot 2 when present. Opaque / transparent / non-motion-prepass payloads leave it undefined.
- `MaterialPluginState` packs the previous-instance buffer in lockstep with the current-instance buffer when at least one active camera has motion enabled — same iteration order so `firstInstance + count` indexes both buffers identically.
