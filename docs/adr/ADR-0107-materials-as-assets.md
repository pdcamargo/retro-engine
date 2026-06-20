# ADR-0107: Materials as assets (derived schema, `.remat`, kind-routed loading)

- **Status:** Accepted
- **Date:** 2026-06-20

## Context

Materials existed only at runtime: `materials.add(new StandardMaterial(...))` minted a `Handle`
in a per-type `Materials<M>` store, and `MeshMaterial3d<M>` serialized that handle **by GUID** — but
a material's *authored fields* (baseColor, roughness, texture handles…) had **no serialization
schema and no file format**. They couldn't be saved, loaded, browsed, or edited as project assets.
A scene that referenced a material GUID threw (nothing loaded the material into its store), so PBR
meshes could not be authored in a scene; and a project's own code couldn't build a material mesh
because the host owns the `StandardMaterial` plugin.

ADR-0055 already mandates "Material is always an asset, never inline," and ADR-0028 deferred the
material-asset / `AsBindGroup` design as an open question. This ADR resolves it. The system must
scale to arbitrary user-defined and `ExtendedMaterial` types with no per-type serialization code.

## Decision

- **The serialization schema is derived from the material's bind-group schema** — the single
  source of truth for its authored fields. `materialReflectionSchema(ctor)` maps uniform packs to
  reflection field types (`vec4f`→`vec4`, `f32`→`number`, …, honoring optional `semantic: 'color'`
  / `meta` annotations for inspector UX) and handle-textures to optional `Handle<Image>` fields.
  A material may declare `static serializedExtras` for CPU-only fields the bind group doesn't cover
  (e.g. knobs). Each `MaterialPlugin<M>` registers the material **value** type as reflectable
  (`registerType`, distinct from the `MeshMaterial3d` component) — so any material, engine or user,
  becomes serializable with **zero extra code**.
- **`.remat` file format**: JSON `{ formatVersion, material: { type, version, data } }`, where the
  body is produced by the reflection codec; texture references serialize by GUID and stream in on
  load. `createMaterialSerializer` / `createMaterialImporter` wrap the codec.
- **Kind-routed loading**: one `.remat` extension maps to many per-type stores, so `AssetServer`
  gained `registerLoaderByKind(kind, store, importer)`; `loadByGuid` prefers a kind loader (keyed by
  the manifest entry's `kind` = material type name) over the extension loader, reserving the handle
  in the correct `Materials<M>` store. Extension loaders (`.rmesh`, `.rescene`) are unchanged.
- **`MaterialTypes` registry**: each `MaterialPlugin` registers a descriptor (kind → ctor, store,
  reflect type, importer, serializer, default factory). `registerMaterialLoaders(app)` wires every
  type's kind loader once an `AssetServer` exists (it may not at plugin-build time). This is also the
  discovery seam for the studio (create / inspect / preview).

Because `MeshMaterial3d<M>` already round-trips its handle and the default scene resolver already
prefers `loadByGuid`, **scene → material references resolve on demand for free** once materials are
loadable — no scene-path changes.

## Consequences

- Any material type — `StandardMaterial`, `UnlitMaterial`, `ExtendedMaterial`, a user's own — is a
  browsable, scene-referenceable, editable `.remat` asset with no bespoke serialization code.
- PBR meshes can be authored directly in a scene (a `Mesh3d` + `MeshMaterial3d<M>` referencing a
  `.remat` GUID), which unblocks the sample project.
- The bind group gains optional, GPU-irrelevant `semantic` / `meta` annotations on uniform fields;
  the schema-derivation reads them so the inspector shows color pickers / ranges.
- `alphaMode` is **not yet serialized** (its `'opaque' | { kind: 'mask'; cutoff } | 'blend'` shape
  needs a bespoke field type); it keeps its constructor default on load. Tracked as a follow-up.
- `ExtendedMaterial` as a saved asset needs a stable `kind` (its synthesized class name) and a
  default factory; flagged for the studio-authoring follow-up.
- In-code `materials.add(...)` keeps working unchanged — file assets are additive.

## Implementation

- `packages/engine/src/material/material-reflect.ts` — `materialReflectionSchema`, `MaterialReflectSource`.
- `packages/engine/src/material/material-importer.ts` — `createMaterialSerializer`,
  `createMaterialImporter`, `MATERIAL_FORMAT_VERSION`.
- `packages/engine/src/material/material-types.ts` — `MaterialTypes`, `MaterialTypeDescriptor`,
  `registerMaterialLoaders`, `MATERIAL_ASSET_EXTENSION`.
- `packages/engine/src/material/material-plugin.ts` — registers the reflectable type + serializer +
  `MaterialTypes` descriptor; `MaterialCtor.serializedExtras`.
- `packages/engine/src/material/bind-group-schema.ts` — `UniformField.semantic` / `.meta`.
- `packages/engine/src/material/standard-material.ts`, `unlit-material.ts` — field annotations + knobs.
- `packages/engine/src/asset/asset-server.ts` — `registerLoaderByKind`, kind-preferring `loadByGuid`.
- `apps/studio/src/project/project-scene.ts` — calls `registerMaterialLoaders` on project load.
