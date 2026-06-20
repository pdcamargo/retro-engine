---
'@retro-engine/engine': minor
---

feat(engine): materials as assets — `.remat` files, derived schema, kind-routed loading

Per ADR-0107, material instances are now serializable, scene-referenceable assets (resolving the
ADR-0028 open question; fulfilling ADR-0055's "material is always an asset"). The serialization
schema is **derived from the material's bind-group schema**, so any material type — engine,
`ExtendedMaterial`, or user-defined — becomes a `.remat` asset with no per-type code. Because
`MeshMaterial3d<M>` already round-trips its handle by GUID, a scene's mesh→material reference now
resolves on demand, which unblocks authoring PBR meshes in a scene.

**New public surface:**

- `materialReflectionSchema(ctor)` / `MaterialReflectSource` — derive a reflection `Schema` from a
  material's `static bindGroup` (+ optional `static serializedExtras`).
- `createMaterialSerializer` / `createMaterialImporter` / `MATERIAL_FORMAT_VERSION` — the `.remat`
  codec round-trip (textures by GUID).
- `MaterialTypes` / `MaterialTypeDescriptor` / `registerMaterialLoaders(app)` /
  `MATERIAL_ASSET_EXTENSION` — the per-type material registry + kind-keyed loader wiring.
- `AssetServer.registerLoaderByKind(kind, store, importer)` — a kind-routed loader; `loadByGuid`
  prefers it over the extension loader when the manifest entry's kind matches.
- `UniformField.semantic` (`'color'`) / `UniformField.meta` — optional, GPU-irrelevant annotations
  that flow into the derived schema for inspector UX (color pickers, ranges).

**Behaviour changes:**

- `MaterialPlugin<M>.build` additionally registers the material value type as a reflectable type,
  its `.remat` serializer, and a `MaterialTypes` descriptor. The kind loader is wired by
  `registerMaterialLoaders` once an `AssetServer` exists.
- `StandardMaterial` / `UnlitMaterial` annotate their color/scalar fields and (StandardMaterial)
  declare `serializedExtras` for `depthBias` / `doubleSided`. `alphaMode` is not yet persisted.
