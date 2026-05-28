# ADR-0051: screen-space motion vectors — per-entity previous-instance buffer + fs_prepass_motion

- **Status:** Accepted
- **Date:** 2026-05-28

## Context

[ADR-0050](ADR-0050-screen-space-prepass-family.md) shipped the screen-space
prepass family for depth and normal, and put the **previous-frame substrate**
in place: `PreviousGlobalTransform` is auto-attached on `Mesh3d` insert and
advanced every `'first'` schedule; `ViewPreviousFrame` plus
`readAndAdvancePrevViewProj` populate `view.prev_view_proj` at bytes 288..352
of the view uniform; the `MotionVectorPrepass` marker exists but was masked
off in `PrepassPlugin`'s Extract with a `warnedMotionDeferred` dev-warn; the
shared `compute_motion_vector(prev_clip, curr_clip)` helper is registered
under `retro_engine::prepass`. The per-entity previous-instance vertex buffer,
the `vs_prepass` motion-vector branch, and the `fs_prepass_motion` /
`fs_prepass_normal_motion` fragment entries remained deferred to a follow-on
slice (`docs/backlog/prepass-motion-vectors.md`).

Phase 12.6 (TAA), 12.9 (DoF), and 12.10 (motion blur) all need a per-pixel
screen-space motion vector. TAA's reprojection is the first concrete consumer
and motivates this slice; the producer ships first so the consumer can land
against a stable contract.

## Decision

Activate the ADR-0050 motion-vector substrate. Add the per-entity
previous-instance vertex buffer, the `vs_prepass` motion-vector branch, and
the motion fragment entries, and unmask the `MotionVectorPrepass` marker.

### HAL

`renderer-core`'s `TextureFormat` union additively grows by `'rg16float'`
(two-channel half-float). `bytesPerTexel` returns 4. WebGPU passes the
format string through unmodified — no backend mapping required. The
prepass's `PREPASS_MOTION_VECTOR_FORMAT` constant narrows from the
placeholder `'rgba16float'` to `'rg16float'`; the motion-vector target is
now half the bandwidth of the placeholder.

### Per-entity previous-instance vertex buffer

A second per-instance vertex buffer carries each visible entity's previous-
frame model matrix at `@location(16..19)`. Layout:
`PREVIOUS_INSTANCE_LAYOUT` — `arrayStride: 64`, four `float32x4` columns,
`stepMode: 'instance'`. Only the model matrix lives here — no
inverse-transpose, because motion-vector reconstruction needs only the clip-
space position, not normal transforms — so the previous-instance stride is
half the current-instance stride (128 → 64).

A sibling `MeshPreviousInstanceBuffer` class mirrors
`MeshInstanceBuffer`'s growth + deferred-destroy lifecycle. The GPU buffer is
lazy: allocated only on the first frame where at least one active camera has
`MotionVectorPrepass` and at least one opt-in material participates. Apps
that never reach for motion vectors pay nothing for the slot.

`MaterialPluginState.queueMaterials` packs the previous-instance buffer in
lockstep with the current-instance buffer — walking the *sorted* `entries`
array (post-`packInstancedBatches`) so a single `firstInstance + count`
slice indexes both buffers identically. Missing `PreviousGlobalTransform`
(theoretically unreachable after the `Mesh3d` insert hook) falls back to
the current model — yields zero motion for that instance and keeps the
buffer indexing consistent.

### Shader entries

`pbr.wgsl` extends `VsIn` and `VsPrepassOut` with conditional fields gated
by `#ifdef PREPASS_MOTION_VECTOR`. When the define is active, `vs_prepass`
computes both `curr_clip` and `prev_clip = view.prev_view_proj *
previous_model * vec4<f32>(in.position, 1.0)`. Three new fragment entries:

- `fs_prepass_motion` — single `vec2<f32>` to the motion target via
  `compute_motion_vector(prev_clip, curr_clip)`.
- `fs_prepass_normal_motion` — combined fragment writing both the normal
  target (`encode_normal_roughness`) and the motion target in one pass.
- `fs_prepass_normal` — unchanged (no motion).

The combined `fs_prepass_normal_motion` keeps cardinality at **one prepass
pipeline per opt-in material per active flag combination**. Splitting into
two pipelines (one normal-only, one motion-only) for cameras that want both
would double the vertex work for no gain.

### Pipeline + shader compilation

`MaterialPluginState` lazily compiles a second variant of the material's
vertex and fragment shader modules with `defines: { PREPASS_MOTION_VECTOR:
true }` on the first request for a motion-enabled prepass pipeline. The
base modules (no motion define) continue to serve the opaque main pass and
the non-motion prepass variants.

`specializePrepass` selects vertex `buffers`, fragment `entryPoint`, and
fragment `targets` per the intersected flag combination:

| `flags`           | Vertex buffers                              | Fragment                             |
|-------------------|---------------------------------------------|--------------------------------------|
| depth-only        | `[mesh, INSTANCE]`                          | `undefined` (no fragment)            |
| normal            | `[mesh, INSTANCE]`                          | `fs_prepass_normal`                  |
| motion            | `[mesh, INSTANCE, PREVIOUS_INSTANCE]`       | `fs_prepass_motion`                  |
| normal + motion   | `[mesh, INSTANCE, PREVIOUS_INSTANCE]`       | `fs_prepass_normal_motion` (combined)|

A sibling `materialSupportsPrepassMotionFragment` (hard-codes
`StandardMaterial`) gates which materials get the motion fragment, mirroring
the existing `materialSupportsPrepassNormalFragment`. `UnlitMaterial` stays
depth-only (no normal data, no motion participation).

### Marker activation

`PrepassPlugin`'s Extract drops the `motionVector: false` mask and the
`warnedMotionDeferred` dev-warn — the marker now flips
`flags.motionVector` to true exactly as `DepthPrepass` and `NormalPrepass`
do for their own flags.
`StandardMaterial.prepassWrites().motionVector` flips to `true`.

### Draw-binding extension

`InstancedDrawPayload` grows an optional `previousInstanceBuffer?: Buffer`
field. `makeInstancedDraw` binds it at vertex slot 2 when present;
otherwise slot 2 stays unbound. The prepass queue populates the field only
on payloads whose pipeline is a motion-vector variant. Opaque /
transparent / non-motion-prepass payloads leave it undefined.

## Consequences

- **Per-instance write cost on motion-enabled cameras**: one
  `Float32Array.set(16 floats)` per visible instance, beyond the existing
  `packInstanceTransform` cost. Bench (`prepass-motion-vectors.bench.ts`,
  ~1000 PBR meshes) measures ~12% overhead vs the current-only pack on a
  Ryzen 9 9950X3D, well within budget.
- **One extra GPU buffer per `MaterialPlugin` instance**, lazily allocated
  the first frame motion is active. No cost for apps that never opt in.
- **One extra vertex-buffer bind (slot 2) per motion-prepass draw call**.
- **`fs_prepass_normal_motion` writes two color attachments in one
  fragment** — no second pass, no second pipeline per camera.
- **Cardinality**: one StandardMaterial camera with `DepthPrepass +
  NormalPrepass + MotionVectorPrepass` produces one prepass pipeline (the
  `d+n+m` variant), not three.
- **Unblocks Phase 12.6 TAA** (the first consumer) and the motion-vector
  half of 12.10 motion blur.
- The `pbr` shader module gains a `#ifdef PREPASS_MOTION_VECTOR` variant
  compiled lazily. The non-motion variant remains the default and pays no
  cost when motion is absent.

## Implementation

### New files

- `packages/engine/src/material/mesh-previous-instance-buffer.ts` —
  `MeshPreviousInstanceBuffer` class (lazy GPU buffer, 1.5× growth,
  deferred-destroy lifecycle mirroring `MeshInstanceBuffer`).
- `packages/engine/src/material/mesh-previous-instance-buffer.test.ts` —
  unit coverage for the sibling buffer.
- `packages/engine/src/prepass/motion-vector.test.ts` — integration tests
  (prepass-item presence, first-frame zero-motion buffer contents,
  motion-variant shader module distinctness, cardinality across N entities).
- `packages/engine/bench/prepass-motion-vectors.bench.ts` — per-frame pack
  cost at ~1000 PBR meshes, current-only vs current + previous-instance.

### Existing files edited

- `packages/renderer-core/src/formats.ts` — `TextureFormat` adds
  `'rg16float'`.
- `packages/engine/src/image/image.ts` — `bytesPerTexel` returns 4 for
  `'rg16float'`.
- `packages/engine/src/prepass/view-prepass-targets.ts` —
  `PREPASS_MOTION_VECTOR_FORMAT` narrows from `'rgba16float'` to
  `'rg16float'`.
- `packages/engine/src/prepass/prepass-plugin.ts` — Extract drops the
  `motionVector: false` mask and the `warnedMotionDeferred` dev-warn.
- `packages/engine/src/material/instance-layout.ts` —
  `PREVIOUS_INSTANCE_LAYOUT`, `PREVIOUS_INSTANCE_BYTE_SIZE`,
  `PREVIOUS_INSTANCE_FLOAT_COUNT`,
  `PREVIOUS_INSTANCE_TRANSFORM_BASE_LOCATION`,
  `packPreviousInstanceTransform`.
- `packages/engine/src/material/instance-batching.ts` — optional
  `InstanceEntry.previousModel`, optional
  `InstancedDrawPayload.previousInstanceBuffer`, `makeInstancedDraw` binds
  slot 2 conditionally.
- `packages/engine/src/material/material-plugin.ts` — motion-active
  detection in `queueMaterials`, lockstep previous-instance pack,
  `ensureMotionShaderModules` lazy variant compile, expanded
  `specializePrepass` fragment selection, `materialSupportsPrepassMotionFragment`.
- `packages/engine/src/material/pbr.wgsl.ts` — `#ifdef
  PREPASS_MOTION_VECTOR` extensions to `VsIn` / `VsPrepassOut`,
  `vs_prepass` motion branch, `fs_prepass_motion`,
  `fs_prepass_normal_motion`.
- `packages/engine/src/material/standard-material.ts` — `prepassWrites()`
  flips `motionVector` to `true`.
- `packages/engine/src/material/index.ts` and
  `packages/engine/src/index.ts` — re-export
  `PREVIOUS_INSTANCE_LAYOUT`, `PREVIOUS_INSTANCE_BYTE_SIZE`,
  `PREVIOUS_INSTANCE_FLOAT_COUNT`,
  `PREVIOUS_INSTANCE_TRANSFORM_BASE_LOCATION`,
  `packPreviousInstanceTransform`, `MeshPreviousInstanceBuffer`,
  `INSTANCE_LAYOUT`, `MESH_INSTANCE_BYTE_SIZE`,
  `MESH_INSTANCE_FLOAT_COUNT`, `packInstanceTransform`.

### Public surface (changeset entry)

`PREVIOUS_INSTANCE_LAYOUT`, `PREVIOUS_INSTANCE_BYTE_SIZE`,
`PREVIOUS_INSTANCE_FLOAT_COUNT`,
`PREVIOUS_INSTANCE_TRANSFORM_BASE_LOCATION`,
`packPreviousInstanceTransform`, `MeshPreviousInstanceBuffer`,
`INSTANCE_LAYOUT`, `MESH_INSTANCE_BYTE_SIZE`, `MESH_INSTANCE_FLOAT_COUNT`,
`packInstanceTransform`. Additive HAL change: `TextureFormat` union grows by
`'rg16float'`. Behaviour: `StandardMaterial.prepassWrites().motionVector`
is now `true`; cameras with `MotionVectorPrepass` produce motion-vector
prepass items.
