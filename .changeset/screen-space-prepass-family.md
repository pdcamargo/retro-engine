---
'@retro-engine/engine': minor
---

feat(engine): screen-space prepass family — depth + normal per-camera (ADR-0050)

Unlocks Phase 12 effects that need per-camera intermediates available before the opaque pass writes the main color target — SSAO needs depth + normal, DoF needs depth, TAA and motion blur will need motion vectors (substrate in place; per-entity previous-instance plumbing deferred to a follow-on slice).

**New public surface:**

- `DepthPrepass`, `NormalPrepass`, `MotionVectorPrepass` — per-camera marker components. Spawning any of them on a camera opts the camera into the screen-space prepass family. `MotionVectorPrepass` is a marker only in this slice; the engine warns once that motion-vector reconstruction lands in a follow-on (`docs/backlog/prepass-motion-vectors.md`).
- `PreviousGlobalTransform` — per-renderable component carrying last frame's `GlobalTransform.matrix`. Auto-attached by `PrepassPlugin` on any `Mesh3d` insert; advanced each frame at the start of `'first'` so render systems see the correct one-frame lag.
- `PrepassPlugin` — installs the sub-graph wiring (between `Shadow3dPass3dNode` and `OpaquePass3dNode`), per-camera target allocation, and `PreviousGlobalTransform` propagation.
- `PrepassNode3d`, `PrepassNode3dLabel` — render-graph node + label.
- `ViewPrepassTargets`, `ViewPrepassCameraTargets`, `ViewPrepassCacheEntry` — per-camera target cache mirroring the `ViewHdrTargets` / `ViewDepthCache` pattern. Depth is shared with `ViewDepthCache`; normal is `rgba16float`, motion-vector slot is `rg16float` (not allocated until the motion-vector slice lands).
- `ViewPreviousFrame` — per-camera previous-frame `view_proj` cache (in `camera/extracted.ts`).
- `PrepassFlagsByCamera` — render-world per-frame flag map populated by `PrepassPlugin`'s Extract.
- `PrepassFlags`, `PREPASS_FLAGS_NONE`, `prepassFlagsAny`, `intersectPrepassFlags` — flag type + helpers.
- `PREPASS_DEPTH_FORMAT`, `PREPASS_NORMAL_FORMAT`, `PREPASS_MOTION_VECTOR_FORMAT` — exported format constants.
- `PREPASS_WGSL` — shared `retro_engine::prepass` shader module (`encode_normal_roughness`, `compute_motion_vector`).
- `MaterialPipelineKey.prepass?`, `MaterialPipelineKey.prepassReadable?` — additive optional fields on the specialize key (one prepass pipeline per unique flag combination; the readable field is reserved for the opaque pipeline's forward-compat `@group(3)` sampling path landing alongside TAA in `docs/backlog/prepass-readable-binding.md`).
- `Material.prepassWrites?(): PrepassFlags` — optional opt-in. `StandardMaterial` returns `{ depth: true, normal: true, motionVector: false }`; `UnlitMaterial` returns `{ depth: true }`.

**Behaviour changes:**

- `VIEW_UNIFORM_BYTE_SIZE` extends 288 → 352. The new `prev_view_proj: mat4x4<f32>` slot at bytes `288..352` is populated by `prepareCameras` from the `ViewPreviousFrame` cache. Non-prepass shaders ignore the slot.
- `OpaquePass3dNode` flips `depthLoadOp` from `'clear'` to `'load'` when `ViewPrepassTargets.perCamera` carries an entry for the active camera — the prepass already populated the depth buffer and re-clearing would discard the work. Single behavior change to an existing render node; covered by `prepass-depth-integration.test.ts`.
- `ViewPhases3d` gains a `prepass: Map<number, PhaseItem3d[]>` field and a `pushPrepass` helper.
- `StandardMaterial` and `UnlitMaterial` implement `prepassWrites()`. `StandardMaterialPlugin` now registers `retro_engine::prepass` ahead of `retro_engine::pbr` so the import resolves even when the consumer does not add `PrepassPlugin`.
- Cameras spawned with `depthTarget: 'none'` plus a prepass marker get a one-shot dev-warn and the prepass is silently skipped (the engine never force-allocates depth when the user has explicitly opted out).
