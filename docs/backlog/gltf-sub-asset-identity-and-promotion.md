# glTF sub-asset stable GUIDs + bake-vs-reference on save

- **Created:** 2026-06-20

## Context

The engine has a save/promote layer (`packages/engine/src/save/`): `serializeProject` →
`promoteAsset` bakes a referenced asset's bytes + a `.meta` sidecar keyed by its GUID, using
the asset kind's registered serializer. For meshes that serializer is `createMeshSerializer`
(`.rmesh`), registered by `MeshPlugin`. So a `Meshes`-store mesh that a scene references is
persisted to the engine's native `.rmesh` on save — verified for procedurally-built meshes
(playground save round-trip, `save-promote` bench).

**glTF assets don't feed into this yet.** When `GltfPlugin` imports a `.glb`/`.gltf`, its
sub-meshes / images / materials are added via `ctx.addLabeledAsset(...)`
(`packages/gltf/src/asset-mapping.ts`), which calls `store.reserveHandle()` **with no GUID**.
So glTF-imported sub-assets are runtime-only — no persistent identity. Consequences today:

- `promoteAsset` refuses them ("handle has no GUID — a runtime-only asset has no persistent
  identity to promote").
- On scene serialize, a no-GUID handle is dropped (`env.handleRef` → `undefined`).

So dropping a glTF mesh into a scene and saving currently neither persists the reference nor
bakes a `.rmesh`. The promote machinery exists; glTF just doesn't reach it.

## Two parts

### 1. Stable GUIDs for glTF sub-assets

Give each glTF sub-asset a deterministic GUID so it has a persistent identity. Derive it from
the source `.glb`'s GUID + the sub-asset's stable label (the importer already labels them
`Mesh{i}/Primitive{j}`, `Material{i}`, `Image{n}`) — so re-importing the same file yields the
same GUIDs and a scene's references stay valid across reimports. Needs `addLabeledAsset` (or the
glTF importer) to mint GUIDs instead of bare `reserveHandle()`.

### 2. Decision: bake vs reference on save (record as an ADR when picked up)

Once glTF sub-assets have GUIDs, choose what a scene saves:

- **Bake (Unity-ish):** `serializeProject` promotes the referenced glTF mesh to `.rmesh` + `.meta`
  on save. The engine owns the geometry; the `.glb` is purely importer input. Uses the existing
  promote path as-is. Cost: duplicated bytes, and edits to the source `.glb` don't flow to baked
  copies without a reimport.
- **Reference (Godot-ish):** the scene stores `{ glbGuid, subIndex }` and the loader pulls the
  sub-mesh from the `.glb` at runtime. The source stays authoritative; no `.rmesh` baking. Cost:
  the `.glb` must ship and be loadable, and addressing sub-assets by index is reimport-fragile
  (mitigated by stable GUIDs from part 1).

A hybrid is possible (reference by default, bake on demand). This is an ADR-worthy decision.

## Acceptance

- A glTF mesh referenced in a scene survives a save → reload with its reference intact.
- Re-importing the same `.glb` keeps existing scene references valid (stable GUIDs).
- The bake-vs-reference behavior is a recorded decision, not an accident of which code path runs.
