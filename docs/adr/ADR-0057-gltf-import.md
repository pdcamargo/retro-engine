# ADR-0057: glTF / GLB Import

- **Status:** Accepted
- **Date:** 2026-06-01

## Context

glTF 2.0 is the primary 3D interchange format, and it is the first asset the engine loads that is
async, multi-file, and decodes into a *graph* of sub-assets rather than a single value. The runtime
asset core (ADR-0055) and the load-context / dependency-loading extension (ADR-0056) exist precisely
to make it expressible. This ADR seals how a glTF (or GLB) file becomes engine data and how it is
brought into the world.

The engine's relevant surfaces were read directly before deciding:

- **Mesh** (`packages/engine/src/mesh`): vertex attributes today are `POSITION` (`f32x3`), `NORMAL`
  (`f32x3`), `UV_0` (`f32x2`), `TANGENT` (`f32x4`), `COLOR` (`f32x4`); `JOINTS_0`/`WEIGHTS_0` are
  intentionally absent (skinning milestone) and `UV_1` is reserved. Indices are `u16` or `u32`.
  `PrimitiveTopology` comes from `renderer-core` (default `triangle-list`). The vertex layout is
  derived from the attributes present and hash-cons'd for allocator bucketing. A renderable is
  `Mesh3d(Handle<Mesh>)` + `MeshMaterial3d<M>(Handle<M>)` — **one mesh, one material, per entity**.
- **Material** (`StandardMaterial`): covers baseColor (factor + texture), metallic, roughness,
  metallic-roughness texture, normal texture, emissive (factor + texture), occlusion texture +
  strength, and alpha mode + cutoff. It does **not** express normal-map scale, double-sided / cull,
  or per-texture samplers (one sampler, shared across all five texture taps — a documented future
  rework).
- **Image**: carries `colorSpace: 'srgb' | 'linear'` (per image) and its own `SamplerDescriptor`.
  Per-slot color space is fully supported.
- **Transform / hierarchy**: `Transform` is TRS (translation `Vec3`, rotation `Quat`, scale `Vec3`);
  `Parent`/`Children` are built via the `Commands` sugar (`withChildren`, `addChild`). There is **no
  `Name` component** anywhere in `packages/`.
- **Coordinates**: the engine is right-handed, +Y up, −Z forward — **identical to glTF**, so no
  coordinate or winding conversion is required.
- **Commands timing**: commands flush per-system, immediately after the system body returns; spawned
  entity rows do not exist until that flush.

glTF intricacies that shaped the design (see Research citations): buffers / bufferViews / accessors
with all component types, normalized integers, `byteStride` interleaving, and sparse accessors; the
GLB binary container (12-byte header + JSON chunk + optional BIN chunk, 4-byte aligned); several
real-world texture-bundling variants; per-slot sRGB vs linear color-space rules; a node graph whose
names are not unique and may be absent; and `extensionsRequired` imposing a hard "refuse to render if
unsupported" obligation.

## Decision

### 1. Package and registration

The loader is a new publishable leaf-style package, **`@retro-engine/gltf`**, that depends on
`@retro-engine/engine` through its public `index.ts` only (it consumes `Mesh`, `StandardMaterial`,
`Image`, `Transform`, `Parent`/`Children`, `Name`, `Mesh3d`, `MeshMaterial3d`, `Assets<T>`,
`Handle<T>`, and the `App`/`Plugin` surface). Engine does not depend on it. A `GltfPlugin` registers
an `AssetImporter` for the `gltf` and `glb` extensions and installs the instantiation reactor; it is
opt-in, so consumers that never load glTF pay nothing — and the future Draco / KTX2 / meshopt WASM
decoders land here without bloating the engine core. This mirrors Bevy's `bevy_gltf` sitting beside
`bevy_render`/`bevy_pbr`.

### 2. In-house parser, no runtime dependency

The GLB container reader, the glTF JSON schema types, and the accessor decoder are hand-rolled — no
runtime parsing dependency for core glTF. The v1 surface is finite and fully specified, the engine's
ethos is from-scratch (hand-rolled WGSL/WebGPU), and owning the parser gives full control over how
decode interleaves with the ADR-0056 dependency-loading flow. The GLB reader validates the 12-byte
header (magic `0x46546C67`, version `2`, total length), then walks chunks (JSON chunk first,
space-padded to 4 bytes; optional BIN chunk, zero-padded). WASM-backed decoders (Draco, KTX2/Basis,
meshopt) are the only places a dependency is later admitted, and only in their deferred phases.

### 3. Container and texture-bundling variants

The importer handles every real-world packaging case through ADR-0056's `LoadContext`:

- `.gltf` JSON + external `.bin` + external image files — siblings fetched via `ctx.read(uri)`.
- `.gltf` with embedded `data:` base64 buffers and/or images — decoded inline, no `read`.
- `.glb` with the BIN chunk holding geometry **and** images-via-`bufferView` — sliced from the BIN
  chunk, no external fetch.
- Mixed (some external, some embedded) — resolved per-URI.
- Image MIME detection by `mimeType` / URI / magic bytes: `image/png` and `image/jpeg` decode in v1;
  `image/ktx2` is recognized but its decode is deferred (gated, see §9).

### 4. Buffers / accessors → `Mesh`

The accessor decoder reads all component types, expands **normalized integers to `float32`** (the
engine's vertex formats are `f32x*`), honors `byteOffset` and `byteStride` (interleaved layouts), and
reconstructs **sparse accessors**. Attribute semantics map: `POSITION→POSITION`, `NORMAL→NORMAL`,
`TEXCOORD_0→UV_0`, `TANGENT→TANGENT`, `COLOR_0→COLOR`. Indices map `u16→u16`, `u32→u32`, and `u8` is
promoted to `u16`. Provided `TANGENT` (VEC4, `w` = handedness) is used as-is; tangent generation when
absent is deferred. `TEXCOORD_1`+ (`UV_1`) and `JOINTS_0`/`WEIGHTS_0` map to attributes the engine does
not yet carry and are deferred (§10). No coordinate or winding conversion is applied.

### 5. Primitive → entity model

A glTF mesh has N primitives, each with its own material and topology, but a renderable entity is one
mesh + one material. Therefore:

- A **single-primitive** mesh node gets `Mesh3d` + `MeshMaterial3d` **on the node entity** itself —
  the common case stays one entity.
- A **multi-primitive** mesh node becomes a parent entity (the transform/name anchor) with **one child
  entity per primitive**, each carrying its own `Mesh3d` + `MeshMaterial3d`.

Primitive modes map to `renderer-core` `PrimitiveTopology` and are **capability-gated**; triangles are
the primary, tested path, with strip/fan/line/point modes mapping where the renderer supports them.

### 6. Materials → `StandardMaterial`

The full pbrMetallicRoughness model maps onto `StandardMaterial`: base-color factor + texture, metallic
and roughness factors, metallic-roughness texture, normal texture **+ scale**, occlusion texture +
strength, emissive factor + texture, alpha mode + cutoff, and **double-sided → cull**. `StandardMaterial`
is extended with `normalScale` and `doubleSided` (and `pbr.wgsl` updated) so imported models render
correctly out of the box — a single-sided import of double-sided foliage/cards/glass is visibly wrong,
and these are core glTF fields, not exotic ones.

**Per-slot color space** is wired to `Image.colorSpace`: base-color and emissive textures are `srgb`;
normal, metallic-roughness, and occlusion textures are `linear`. **Samplers**: glTF sampler wrap/filter
maps to the `SamplerDescriptor` carried per `Image`. Because the engine binds one sampler per image
(and `StandardMaterial` currently shares one sampler across taps), a texture that needs a sampler
differing from how its image is otherwise used is handled by **duplicating the `Image`** with the
divergent sampler. Full per-texture samplers and `KHR_texture_transform` (per-texture UV transform) are
**deferred** — both need the WGSL/binding rework already noted in the material source.

### 7. Image dedup

Within a single load, one `Handle<Image>` is minted per unique image source (URI or `bufferView`), so
an image referenced by several materials is decoded and uploaded once. Cross-file dedup remains the
path-based dedup the `AssetServer` already provides.

### 8. The `Gltf` root asset and instantiation

**Root asset shape** (mirroring Bevy's dual index + named-map access):

- `scenes` + `namedScenes` + `defaultScene`
- `meshes` + `namedMeshes`, `materials` + `namedMaterials`, `images`
- `nodes: GltfNode[]` + `namedNodes`
- **reserved (deferred):** `skins` + `namedSkins`, `animations` + `namedAnimations`

with `GltfNode { transform (TRS), children: number[], mesh?: number, skin?: number /*reserved*/,
name? }`, `GltfScene { nodes: number[], name? }`, `GltfMesh { primitives: GltfPrimitive[], name? }`,
and `GltfPrimitive { mesh: Handle<Mesh>, material?: Handle<StandardMaterial> }`. Sub-assets are
registered via `addLabeledAsset` (the label doubles as a future addressing key); the
`load('model.gltf#Mesh0')` string-addressing sugar is deferred — the root's arrays and named maps give
handle access today.

**Node → entity instantiation (the headline requirement).** The `Gltf` root is inert data; bringing it
into the world mirrors the node graph as a navigable entity tree:

- A new general-purpose **`Name`** component (`class Name { value: string }`) is introduced in the
  engine. It is a standalone value component — no `requires`, no hooks — used by glTF now and by the
  future scenes/prefabs system.
- A **`GltfSceneRoot { handle: Handle<Gltf>, scene? }`** component marks an entity to be populated. A
  `GltfPlugin` reactor system runs in `update`: for each `GltfSceneRoot` not yet instantiated, it checks
  the `Gltf` store for the handle's value (a **store-presence poll** — the same idiom the material and
  image prepare systems use to react to async readiness; there is no ECS-level asset-ready event). When
  present, it recursively spawns the node subtree as children via the `Commands` `withChildren`/`addChild`
  sugar, giving each node entity a `Transform` from its TRS and a `Name` from its node name, and attaching
  `Mesh3d` + `MeshMaterial3d` per the single/multi-primitive rule. Running in `update` lets `postUpdate`
  transform propagation compute every `GlobalTransform` the same frame.
- The result is recorded on the root as a **`GltfInstanceNodes`** component holding the primary
  **node-index → `Entity`** array (1:1 — what `GltfScene.nodes` and future skin joints reference) plus a
  convenience **name → `Entity[]`** map, with `findByName` (first match in document order) and
  `findAllByName` helpers. glTF names are not unique, so the map is multi-valued; nameless nodes get **no**
  `Name` (no synthesized `"node_3"`). The map is built from reserved entity ids at enqueue time, never by
  querying after spawn (rows do not exist until the per-system command flush). Node entities are also
  queryable by the `Name` component for the general case. This is exactly the "instantiate a character,
  then `findByName('eye')` to parent a camera onto the bone" workflow.

**Prefab reconciliation.** This is the first concrete prefab-instantiation in the engine. `GltfSceneRoot`
+ `Name` are deliberately forward-compatible with the scenes/prefabs initiative: when that system lands, a
glTF scene becomes a prefab **source** consumed through the same instantiation model, not a parallel one.
glTF import is not blocked on the (far-future) prefab system.

### 9. v1 KHR extension set and the required-extension contract

v1 supports **core glTF only**. The importer parses `extensionsRequired`; if it lists any extension the
loader does not support, the load **fails** with a clear error (the spec's "must not render" obligation).
Unknown extensions present only in `extensionsUsed` (not required) are ignored. `KHR_materials_emissive_strength`
is a cheap fast-follow — the engine has the HDR pipeline (ADR-0048), so emissive values above 1 are valid.
Deferred: `KHR_materials_unlit`, `KHR_texture_transform`, `KHR_lights_punctual`, `KHR_texture_basisu`,
`KHR_draco_mesh_compression`, `EXT_meshopt_compression`, and the advanced `KHR_materials_*` family.

### 10. Capability gating from day 1

Even though they are deferred, the WebGL2-incompatible delivery paths are gated on
`RendererCapabilities` from the outset so they cannot sneak in unflagged: skinning joint-palette
delivery (uniform buffer for small skeletons vs **storage buffer** for large), morph-target delta
delivery (**storage**), and Draco / KTX2 / meshopt decode (WASM, possibly compute).

### 11. Validation and error contract

A `GltfImportError` (in the gltf package) covers: bad GLB magic/version, malformed JSON, an unsupported
required extension, a missing or out-of-bounds buffer/bufferView/accessor, and an unsupported image
MIME type. It surfaces through the `AssetServer`'s existing `AssetLoadFailure` (`{ path, handle, error }`),
and — by ADR-0056 §3 — a failed import commits no partial subgraph.

### 12. Deferred, designed, and not precluded

The foundation reserves room for these so they bolt on without rework:

- **Skins / GPU skinning** — `GltfSkin { joints: number[], inverseBindMatrices: Handle<…> }`; a bone *is*
  a node entity (§8); `JOINTS_0`/`WEIGHTS_0` join the `MeshAttribute` set (their attribute ids reserved);
  palette delivery gated per §10.
- **Morph targets** — `primitive.targets` (POSITION/NORMAL/TANGENT deltas) + `mesh.weights`; the `Mesh`/GPU
  representation is designed so deltas attach later (extra attributes vs storage) without reworking the v1
  mesh.
- **Animations** — an `AnimationClip` asset (channels: target node + path T/R/S/weights; samplers:
  input/output accessors with LINEAR/STEP/CUBICSPLINE) keyed to node indices, consumed by a future
  animation system (its own roadmap). No player is built here.

## Consequences

**Easier.** Real-world models — any container and texture-bundling variant — load and render with correct
PBR and color management out of the box. A consumer can instantiate a model and look up an entity by node
or bone name to attach gameplay (cameras, weapons, effects). The node graph becomes a navigable, named
entity tree that the studio inspector and the future prefab system reuse. Skins, morph targets, and
animation slot onto reserved structures rather than forcing a re-architecture.

**Harder / accepted trade-offs.**

- The in-house parser owns glTF conformance — sparse accessors, normalized-integer expansion,
  interleaving, and validation are ours to get right and to test against the Khronos sample models.
- Per-texture sampler divergence duplicates images until the material's single-sampler binding is
  reworked; `KHR_texture_transform` waits on the same rework.
- Extending the shipped `StandardMaterial` + `pbr.wgsl` (`normalScale`, `doubleSided`) touches a
  published surface and the PBR shader, and requires per-material cull to be expressible in the pipeline.
- v1 refuses files that *require* an unsupported extension. That is correct per spec, but means some
  Draco/KTX2/meshopt-compressed assets will not load until their deferred phases ship.

## Implementation

- `@retro-engine/gltf` — `src/index.ts` re-export entry; concern files (per CLAUDE.md §5.5) for the GLB
  container reader, glTF JSON schema types, accessor decoder, mesh mapping, material/image/sampler mapping,
  the `Gltf` root + `GltfNode`/`GltfScene`/`GltfMesh`/`GltfPrimitive` types, the importer registration, the
  `GltfSceneRoot`/`GltfInstanceNodes` components, the instantiation reactor system, `GltfPlugin`, and
  `GltfImportError`.
- `packages/engine/src/name.ts` — `Name` component; exported from `packages/engine/src/index.ts`.
- `packages/engine/src/material/standard-material.ts` + `pbr.wgsl` — `normalScale`, `doubleSided` (cull).
- Builds on ADR-0056 (`LoadContext`: `read`, `addLabeledAsset`, atomic on-schedule sub-asset commit).
- (Reverse linkage only, per CLAUDE.md §4: shipped `packages/*/src/**` must not reference any `docs/` path
  or ADR id — the implementer wires these symbols without naming this ADR in source.)

## Research citations

- glTF 2.0 specification (container, accessors, materials, nodes, scenes):
  <https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html>
- GLB binary container layout (header + JSON/BIN chunks, alignment):
  <https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#binary-gltf-layout>
- Sparse accessors / `byteStride` interleaving / normalized integers:
  <https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#accessors>
- pbrMetallicRoughness, normal `scale`, occlusion `strength`, `alphaMode`, `doubleSided`:
  <https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#materials>
- Texture/image sRGB-vs-linear color-space rules:
  <https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#metallic-roughness-material>
- Sampler wrap/filter enum values:
  <https://github.com/KhronosGroup/glTF/blob/main/specification/2.0/schema/sampler.schema.json>
- `extensionsUsed` vs `extensionsRequired` (the unsupported-required obligation):
  <https://github.com/KhronosGroup/glTF/blob/main/extensions/README.md>
- KHR_texture_basisu (deferred KTX2/Basis path):
  <https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_texture_basisu/README.md>
- KHR_draco_mesh_compression (deferred):
  <https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_draco_mesh_compression/README.md>
- Bevy `Gltf` asset shape (named scenes/nodes/meshes/materials/animations):
  <https://docs.rs/bevy/latest/bevy/gltf/struct.Gltf.html>
- Bevy `GltfNode` + name-based lookup after scene spawn:
  <https://docs.rs/bevy/latest/bevy/gltf/struct.GltfNode.html>
- Unity model import: node graph → GameObject hierarchy, bone attachment by name:
  <https://docs.unity3d.com/Manual/ImportingModelFiles.html>
