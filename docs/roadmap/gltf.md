# glTF Import

- **Created:** 2026-06-01
- **Status:** Planning
- **Decisions:** ADR-0057 (glTF/GLB import), ADR-0056 (asset load context & dependency loading),
  ADR-0058 (doubleSided + normalScale), ADR-0059 (glTF image-decode port)

## Goal

`@retro-engine/gltf` loads `.gltf` and `.glb` files of any container / texture-bundling variant into
engine assets and instantiates them as a navigable entity tree that mirrors the glTF node graph —
each node an entity with a `Transform` and a `Name`, parent/child wired, mesh nodes carrying
`Mesh3d` + `MeshMaterial3d`, with correct PBR and color management. A consumer can instantiate a model
and look up an entity by node or bone name (`findByName('eye')`) to attach their own entities. The v1
foundation does not preclude skins, morph targets, or animations — their asset shapes and the
WebGL2-incompatible delivery paths are reserved and capability-gated from day 1.

This promotes Phase 11 of `renderer.md` into its own initiative. It depends on the asset system core
(ADR-0055, shipped) and the load-context extension (ADR-0056).

## Phases

### Phase A — v1 foundation (build first)

Each item is a `docs/backlog/*.md`, sequenced.

1. ✅ **`asset-load-context`** *(shipped, ADR-0056)* — the `LoadContext` (sibling `read`,
   `addLabeledAsset`, atomic on-schedule multi-asset drain, sibling-path resolver). Prerequisite for
   everything below.
2. ✅ **`engine-name-component`** *(shipped, ADR-0057)* — the `Name` primitive in `packages/engine`.
   Small, standalone; also a prerequisite for the scenes/prefabs initiative.
3. ✅ **`standard-material-doublesided-normalscale`** *(shipped, ADR-0058)* — extended the shipped
   `StandardMaterial` + `pbr.wgsl` with `normalScale` (tangent-free derivative cotangent-frame normal
   mapping) and `doubleSided` (per-material cull + back-face normal flip).
4. ✅ **`gltf-package-and-parser`** *(shipped, ADR-0057)* — scaffolded `@retro-engine/gltf`; in-house
   GLB/glTF parser + accessor decoder; all bundling variants; MIME detection; `GltfImportError` +
   validation contract.
5. ✅ **`gltf-mesh-and-material-mapping`** *(shipped, ADR-0057/0059)* — primitives → `Mesh` (semantics,
   normalized ints, stride/sparse, index promotion, topology gating); materials → `StandardMaterial`;
   per-slot color space; sampler mapping + image dedup/duplication; injected image-decode port.
6. ✅ **`gltf-root-asset-and-instantiation`** *(shipped, ADR-0057)* — the `Gltf` root +
   `GltfNode`/`GltfScene`/`GltfMesh`/`GltfPrimitive`; sub-asset labelling; `GltfSceneRoot` +
   `GltfInstanceNodes` + the `GltfPlugin` reactor; named-node/bone lookup. **Phase A (v1) complete.**

### Phase B — deferred (designed in ADR-0057, not built; foundation accommodates)

> **Do not delete this roadmap when Phase A (v1) ships.** This file is the live tracker for the Phase B
> items below; ADR-0057 §12 only records the *design*, not the open work. The initiative is "done" — and
> this file deletable — only once Phase B is empty (each item shipped or explicitly dropped). Promote an
> item to `docs/backlog/` when its prerequisites land and a real consumer needs it.

- **Skins / GPU skinning** — `GltfSkin`; `JOINTS_0`/`WEIGHTS_0` attributes; joint-palette delivery
  (uniform vs storage, gated). (renderer 11.5) **Promoted into its own initiative:**
  `docs/roadmap/skeletal-animation.md` (Phase 0).
- **Morph targets** — `primitive.targets` + `mesh.weights`; delta delivery (attributes vs storage).
- **Animation clips** — `AnimationClip` keyed to node indices; the player belongs to a future
  animation system (likely its own roadmap). (renderer 11.6) **Promoted into its own initiative:**
  `docs/roadmap/skeletal-animation.md` (Phase 1+).
- **Compression** — `KHR_draco_mesh_compression`, `EXT_meshopt_compression`, `KHR_texture_basisu`
  (KTX2/Basis); vendored WASM decoders, capability-gated.
- **Advanced materials** — `KHR_materials_unlit`, `KHR_texture_transform`, advanced `KHR_materials_*`;
  full per-texture samplers (needs the material single-sampler binding rework).
- **Sub-asset string addressing** — `load('file.gltf#Mesh0')`, `#Mesh0/Primitive0`. (renderer 11.4)
- **Tangent generation** when `TANGENT` is absent; `TEXCOORD_1` (`UV_1`); `GltfExtras` (renderer 11.7);
  `GltfLoaderSettings` (renderer 11.8).

## Open questions

- **Tangent generation algorithm** — MikkTSpace-style generation when `TANGENT` is absent; deferred,
  but the algorithm choice affects normal-map correctness and should be an ADR when promoted.
- **Joint-palette delivery threshold** — at what joint count does uniform-buffer delivery hand off to a
  storage buffer (and thus a capability gate)? Decided when skinning is promoted.
- **Animation system home** — `engine` vs a separate `@retro-engine/animation` package (open in
  `renderer.md` too). Triggered by Phase B animations.

## Links

- ADR-0057 (glTF/GLB import), ADR-0056 (load context), ADR-0055 (asset system)
- `docs/roadmap/renderer.md` — Phase 11 (this initiative is the promotion of it)
- `docs/roadmap/asset-system.md` — handle/store model this consumes
- `docs/roadmap/scenes-and-prefabs.md` — glTF instantiation is the first concrete prefab-instantiation;
  shares the `Name` component
- Bevy `bevy_gltf` (shape reference): <https://docs.rs/bevy/latest/bevy/gltf/index.html>
- glTF 2.0 specification: <https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html>
