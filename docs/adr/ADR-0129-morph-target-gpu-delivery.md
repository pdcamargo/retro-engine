# ADR-0129: Morph-target GPU delivery via storage buffers, gated on `storageBuffers`

- **Status:** Accepted
- **Date:** 2026-06-27

## Context

Runtime morph targets (glTF blend shapes — facial expressions, visemes, correctives) deform a
mesh each frame: `position += Σ weightₜ · deltaₜ[vertex]`, and likewise for normals. The deltas are
per-target, per-vertex, static (mesh geometry). The weights are per-entity and animate. We must
decide how both reach the vertex shader.

Three delivery mechanisms exist, and the choice is the morph analogue of the joint-palette decision
in ADR-0115:

1. **Vertex attributes** — one extra `vec3` attribute per target per vertex. WebGL2 caps total
   vertex attributes at 16. This renderer already saturates that budget: mesh attributes occupy
   shader locations 0–7 and per-instance transform data occupies 8–15. There is no room for even one
   morph-delta attribute without dropping an existing one. This path does not survive contact with
   the existing layout.
2. **Storage buffers** — deltas and weights as `var<storage, read>`, the vertex shader indexing by
   `@builtin(vertex_index)`. Scales to any target count. WebGPU-only (`storageBuffers`); WebGL2 has
   no SSBOs at all. This is exactly how ADR-0115 delivers the joint palette.
3. **Data texture** — deltas packed into a `texture_2d_array` (one layer per target), sampled by
   computed pixel coordinates. The only path that runs on both WebGPU and WebGL2 (Bevy chose this for
   precisely that reason: it dodges both the attribute budget and the absent-SSBO problem). More
   plumbing (pixel packing, format limits, per-component texel layout).

The roadmap's parenthetical preference for the vertex-attribute path predates this layout audit;
research (Bevy's morph implementation, the WebGL2 attribute cap) shows it is the weakest option.

## Decision

Deliver morph deltas and weights through **read-only storage buffers bound at `@group(3)`**, gated on
`RendererCapabilities.storageBuffers`. A single delivery path — no vertex-attribute path, no
uniform-array path, no delivery threshold.

- **Deltas** (per mesh, static): one storage buffer per morphing mesh, target-major
  (`delta[t · vertexCount + v]`), each element a position delta + normal delta. Created when the mesh
  uploads, freed when it unloads. Tangent deltas are not stored — the PBR shader reconstructs the
  tangent frame from screen-space derivatives and consumes no per-vertex tangent.
- **Weights** (per entity, per frame): a small storage buffer of `f32`, one per target, uploaded
  each frame from the entity's `MorphWeights` component.
- **Params** (per draw): a uniform carrying `vertex_base` (the mesh's slab `baseVertex`, subtracted
  from `@builtin(vertex_index)` so the per-mesh delta buffer indexes from 0) and `target_count`.
- Morphed meshes are emitted **one draw per entity** (instance count 1); a morphing mesh is a unique
  entity (a face), not an instanced crowd, so the per-entity weights/params buffers and the per-mesh
  delta buffer are bound together in a per-draw `@group(3)` bind group. The rigid per-instance vertex
  layout is reused unchanged — morphing adds no new vertex attributes.
- The vertex shader applies morphing **before** skinning (glTF order), so a skinned-and-morphed
  variant composes the two: morph the base position/normal, then run the joint palette over the
  result.

This resolves the roadmap's "morph delta delivery threshold" open question: there is no threshold. A
single storage path covers small and large target counts; the cost of a second (attribute) path is
not justified when the attribute budget cannot host it.

**WebGL2** has no storage buffers, so morphing is unavailable there — the same posture ADR-0115 took
for skinning. The WebGL2-reachable path is the data-texture approach (mechanism 3 above); it is
declared and deferred, not designed here. A morphed mesh on WebGL2 draws from its base geometry.

## Consequences

- Mirrors the skinning delivery model exactly (storage buffer at `@group(3)`, capability-gated,
  WebGL2 path deferred), so there is one mental model for GPU-side deformation, not two.
- `@group(3)` is shared by SSAO, the skinning palette, and now morph data. On a given pipeline
  variant they are mutually exclusive except where a variant deliberately combines them (the
  skinned-and-morphed variant binds palette + deltas + weights together). This keeps WebGPU's
  four-bind-group budget intact.
- Subtracting `vertex_base` from `@builtin(vertex_index)` lets morphed meshes keep using the shared
  slab allocator (non-zero `baseVertex`) instead of forcing a private vertex buffer per morphing mesh.
- Morphed meshes do not instance-batch in v1. Acceptable: morphing entities are few and unique.
  Instanced morphing (a crowd sharing one weight set) is not a current need; if it arrives it is an
  additive variant, not a rework.
- The motion-vector prepass for morphed meshes is deferred (morphing is applied in the main pass and
  the depth/normal prepass, not the motion-vector prepass); morphed meshes fall back to base-geometry
  velocity, a minor TAA artefact tracked as deferred work.
- WebGL2 users get no runtime morphing until the data-texture path lands — but the RetroHuman
  customization flow (the headline consumer) is edit-time CPU bake, which needs no runtime morph at
  all, so the gap does not block it.

## Implementation

- `packages/engine/src/morph/morph-weights.ts` — `MorphWeights` component (authored: `names`,
  `weights`).
- `packages/engine/src/morph/morph-targets.ts` — `MorphTargets` mesh-side delta store (`MorphTarget`,
  per-target position/normal deltas).
- `packages/engine/src/morph/morph-gpu.ts` — per-mesh delta buffer + per-entity weights/params buffer
  + bind group; `@group(3)` layout.
- `packages/engine/src/morph/morph-plugin.ts` — `MorphPlugin`: component registration, per-frame
  weights upload, queue integration.
- `packages/engine/src/material/pbr.wgsl.ts` — `#ifdef MORPHED` block in `vs_main` / `vs_prepass`.
- `packages/gltf/src/mesh-mapping.ts` — parse `primitive.targets`; `packages/gltf/src/schema.ts`
  (`mesh.extras.targetNames`); `packages/gltf/src/gltf-instantiate.ts` — attach `MorphWeights`.
- `packages/renderer-core/src/capabilities.ts` — `RendererCapabilities.storageBuffers` (existing gate).
