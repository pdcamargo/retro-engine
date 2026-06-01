---
'@retro-engine/assets': minor
---

feat(assets): asset identity and storage primitives — `Handle<T>`, id model, `Assets<T>` store, registry/source types

Stands up the new `@retro-engine/assets` leaf package (zero internal deps). It generalizes the per-type registries the engine grew for meshes, images, materials, and atlas layouts into one shape, without yet retrofitting any of them.

**New public surface:**

- `AssetIndex` — branded `number`, the dense runtime slot and hot-path lookup key. Minted monotonically with no reuse.
- `AssetGuid` — branded `string`, a random v4 UUID; the persistent identity and serialization key. `generateAssetGuid()` mints one.
- `AssetId<T>` — logical identity: `{ kind: 'runtime', index }` or `{ kind: 'guid', guid, index }`. `assetIndexOf(id)` returns the store key. `asAssetIndex(n)` brands a raw number.
- `Handle<T>` — cheap value reference: `index`, optional `guid`, phantom `T` so `Handle<Mesh>` is not assignable to `Handle<Image>`. `makeHandle(index, guid?)` builds one; `handleEq` compares by index.
- `Assets<T>` — generic store over `Map<AssetIndex, T>`: `add` → `Handle<T>`, `get`, `getMut` (queues `modified`), `insert`, `remove` (queues `removed`), `reserveHandle` (async-load slot), `has`, `size`, `iter`, `drainEvents`.
- `AssetEvent<T>` — `added | modified | removed | unused`, each carrying the handle (`unused` is tooling-only; nothing frees on it).
- `AssetImporter<T>` / `AssetImportContext` / `AssetImporterRegistry`, `AssetSerializer<T>` / `AssetSerializerRegistry` — strategy registry **types** only, no wiring.
- `AssetSource`, `AssetManifest` / `AssetManifestEntry` — the swappable byte source and GUID→location manifest, designed as types only; concrete sources land later.

No behavior change anywhere else — the engine does not import this package yet.
