# ADR-0055: Asset System — Id, Handle, Store, and the Asset/Inline Boundary

- **Status:** Accepted
- **Date:** 2026-05-31

## Context

The engine already carries four asset-shaped types. Each one ships its own hand-rolled registry that
re-implements the same `add` / `get` / `mutate` / `remove` / `drainPendingChanges` shape over a
branded-`number` handle, paired with a render-world cache and an Extract→Prepare pipeline:

| CPU type | Handle | Main store | Render cache | GPU notes |
|---|---|---|---|---|
| `Image` (ADR-0030) | `ImageHandle` | `Images` (seeds `WHITE`/`BLACK`/`NORMAL_FLAT`) | `RenderImages` | `uploadImage`; bind-group schema resolves handle→`RenderImage` with fallback |
| `Mesh` (ADR-0024/0025) | `MeshHandle` | `Meshes` | `RenderMeshes` | `MeshAllocator` frees on `removed`/`modified`; `vertexSlice(handle)` at draw time |
| `Material` (ADR-0028/0035) | `MaterialHandle<M>` | `Materials<M>` (one per type) | `RenderMaterials<M>` | per-type bind-group schema + specialized pipeline |
| `TextureAtlasLayout` (ADR-0032) | `TextureAtlasLayoutHandle` | `TextureAtlasLayouts` | — | layout metadata only |

Each of those files carries a TSDoc note that it folds into `@retro-engine/assets` once that package
lands. This is that decision. The asset system must **absorb** the four types into one asset concept,
not stand beside them as a fifth parallel store.

The id / handle / asset-vs-inline model is the expensive-to-reverse part of the engine's future: it
gates scenes and prefabs, reflection and serialization, the editor SDK + studio asset browser, and
the web build target. This ADR therefore seals the full model — including the persistent, project-
backed GUID tier — even though only the runtime slice is built first. The persistent tier (on-disk
GUID metadata, manifest, disk/bundle sources, promotion, studio browser) is designed here and built
later as a separate initiative, so it lands as a pure addition rather than a re-litigation of the id
model.

Two reference systems were studied before deciding (see Research citations):

- **Bevy.** `AssetId<A>` is `Index` (efficient runtime slot, the default) or `Uuid`
  (stable-across-runs, only when explicitly registered). `Handle<A>` is `Strong` (an `Arc`; the asset
  lives until the last strong handle is dropped) or weak/uuid (does not keep the asset alive).
  `Assets<A>::add` mints a runtime asset and returns a strong handle; `get_mut` emits
  `AssetEvent::Modified`; `remove` emits `Removed`. `AssetEvent` covers `Added`, `Modified`,
  `Removed`, `Unused` (last strong handle dropped), `LoadedWithDependencies`. `AssetServer::load`
  returns a strong handle immediately and populates it asynchronously; hot-reload mutates the asset
  in place behind the stable handle.
- **Unity.** A `.meta` sidecar stores a GUID assigned at import; the GUID survives move/rename so
  references never break, and references between assets are stored by GUID, not by path. Losing the
  `.meta` mints a fresh GUID and breaks every reference. `AssetDatabase.CreateAsset` promotes an
  in-memory object into a persisted project asset on disk.

## Decision

### 1. Identity is index-primary, GUID-for-persistence

- **`AssetIndex`** — a branded `number`, a dense runtime slot assigned by the store on insert. This
  is the hot-path lookup key. Render caches stay `Map<AssetIndex, RenderT>` (the exact shape they
  have today), so draw-time keying remains numeric with no regression.
- **`AssetGuid`** — a branded `string` holding a **random v4 UUID**. It is the persistent identity and
  the serialization key only; it never appears on the draw hot path.
- **`AssetId<T>`** — the logical identity: `{ kind: 'runtime', index }` or
  `{ kind: 'guid', guid, index }`. A GUID-backed asset is assigned an `index` when it is loaded, so
  at runtime *everything* has an index; the GUID is metadata for persistence.
- **`Handle<T>`** — a cheap value object wrapping an `AssetIndex`, an optional `AssetGuid`, and a
  phantom `T` so `Handle<Mesh>` is not assignable to `Handle<Image>`. The hot path is `handle.index`.
- The store allocates indices **monotonically with no reuse** in v1 (the engine's current behavior).
  Generational slot reuse is a deferred optimization, not part of this decision.

GUIDs are random v4, **not** content-addressed. A GUID's job is stable identity across edits and
renames; content-addressing changes the id on every edit and severs every reference — the opposite of
what an editor needs. Content hashing is a cache/dedup key and may be layered on later for import
dedup without ever becoming the identity.

### 2. Handles are plain values; no `Arc`/`Drop`, no strong/weak split

JavaScript has no deterministic destructor, and `FinalizationRegistry` is non-deterministic and
explicitly unsuitable for resource management. Bevy's "free the asset when the last strong handle
drops" therefore cannot be reproduced, and emulating it with manual `clone()` / `release()` is an
ergonomic tax that fights the ECS (every handle-bearing component would need a despawn hook). So:

- A `Handle<T>` keeps nothing alive and nothing auto-frees.
- An asset's lifetime is owned by its `Assets<T>` store. Unload is **explicit** (`assets.remove`) or
  **bulk** via scene/state teardown (the scenes system despawns on `OnExit`).
- The strong/weak distinction collapses — every handle both resolves and never keeps-alive — so the
  public surface is a single `Handle<T>`.
- A conceptual reference count may be tracked for editor diagnostics and an `Unused` event, but it is
  never used to free an asset.

This divergence from Bevy is a runtime constraint, not a simplification.

### 3. Loading is immediate-handle + schedule-bound drain

`AssetServer.load<T>(path)` returns a `Handle<T>` synchronously (it reserves an index; the value is
not yet present). The IO — `fetch` / decode / file read — runs off-schedule as a promise. A
schedule-bound system in `PreUpdate` (main world) moves completed loads into the `Assets<T>` store and
queues `AssetEvent.Added`. Consumers call `assets.get(handle)` and receive `undefined` until the value
arrives; the existing default-fallback machinery (`Images.WHITE`, …) already handles "not ready yet".

This keeps all ECS mutation single-threaded and deterministic, runs the drain **before**
`RenderSet.Extract` so a load completed this frame is visible to extraction, and makes hot-reload
trivial: the handle is stable across a reload, so swapping the value and firing `Modified` reuses the
existing prepare-invalidation path. `Promise<Handle>` as the API is rejected (it pushes async into
gameplay and breaks "spawn an entity now that references an asset still loading"); observable handles
as the primary surface are rejected as over-built, since `AssetEvent` already carries change signals.

### 4. One `AssetServer`, a swappable `AssetSource`

GUID→bytes resolution is abstracted behind an `AssetSource` reader plus an `AssetManifest`
(GUID→location). The studio injects a disk source (loose files, live importers, watched); the web
build injects a bundle source (pre-baked, manifest from the bundle, no importers at runtime). One
`AssetServer` API, an injected source — the renderer-backend dependency-injection pattern applied to
assets. This initiative ships only the runtime path: the `AssetSource` interface and one fetch-backed
source. The disk source, bundle source, and manifest are designed here and built later.

### 5. Importers and serializers register; they do not subclass

`AssetImporterRegistry` maps a file extension or asset kind to an importer **function**
`(bytes, ctx) => T | Promise<T>`. `AssetSerializerRegistry` maps an asset type to a
`{ serialize, deserialize }` record. Both register through plugin `build()`. A new asset type is added
by registration, never by extending a base importer.

### 6. The asset / inline-value boundary

- An **asset** is shared, addressed by `Handle<T>`, lives in `Assets<T>`, round-trips by reference
  (index at runtime, GUID on disk), and is hot-reloadable.
- An **inline value** is private POD owned by one component instance, has no handle and no store
  entry, is serialized inline by reflection, and dies with its component (a tint colour, a sprite
  rect, an offset vector).
- The test: *is it shared, referenced by id, or able to round-trip independently?* → asset; otherwise
  inline.

**Material is always an asset, never inline.** The engine already keys GPU preparation, the prepared
bind group, and instanced batching by `MaterialHandle`; inlining a material would re-prepare a bind
group per entity per frame and destroy that caching model — a measured cost, not a matter of taste. A
material that is unique to one entity is served by minting a **runtime** asset
(`materials.add(new StandardMaterial({…}))`, a cheap runtime index), not by inlining. Materials keep
**one store per material type** (`Assets<M>` per `M`), preserving the per-type bind-group schema and
specialized pipeline that the render path depends on.

### 7. Code-created assets and editor promotion

- `assets.add(value)` mints a runtime `AssetIndex` and returns a `Handle<T>` with no GUID. A
  code-created asset differs from a project asset only by an absent GUID and absent file; it is fully
  usable, GPU-prepared, and hot-mutable (`assets.getMut(handle)` emits `Modified`).
- Promotion (the Unity `CreateAsset` analogue) mints a **fresh v4 GUID** — it does not adopt the
  runtime number, which is a different id kind — writes the asset file, registers the value under the
  GUID while the runtime index remains a valid session-local alias to the same value, and returns a
  GUID-backed handle. The editor rewrites the references it is *saving* to the GUID handle; live
  components keep their session handle and resolve unchanged; on the next load they receive the GUID
  handle.
- A code-created asset does **not** appear in the editor until it is promoted: with no GUID and no
  file it is invisible to the asset browser, which lists the manifest/disk. Promotion is what surfaces
  it — exactly Unity's transient-object-until-`CreateAsset` behavior.
- The editor flows this model must preserve (built in the later initiative): the browser lists project
  assets by manifest; drag-drop mints a component referencing the GUID handle; rename moves the file
  and updates the manifest path while the GUID is unchanged, so references survive; hot-reload swaps
  the value behind a stable handle and fires `Modified`, driving change detection; an inspector edit
  marks the asset dirty and the serializer writes it back.

### 8. Package boundary

`packages/assets` is a pure leaf. It exports only the storage and identity primitives and the
registry/source **types** — no `App`, no `Param`, no systems — so it depends on nothing else in the
repo and joins `math` and `renderer-core` as a leaf. `packages/engine` consumes it and owns the wiring
(`AssetServer`, `AssetPlugin`, the load-drain system, and repointing `Image`/`Mesh`/`Material`/atlas
onto `Assets<T>`). The dependency runs `engine → assets` only, never the reverse.

## Consequences

**Easier.** One id model underpins scenes, reflection, the editor, and the web build, instead of four
divergent registries. Adding an asset type is a registration plus a store instance. Code-created and
project-backed assets share a single handle type and call surface, so promotion is a re-tag of an
existing value rather than a type change at every call site. Hot-reload and editor edits ride the
existing Extract→Prepare invalidation because the handle is stable across a value swap.

**Harder / accepted trade-offs.**

- No automatic unload. Because JS cannot free on last-handle-drop, asset lifetime is explicit or
  scene-scoped. Long sessions that churn many runtime assets without removing them will grow the
  store; the monotonic no-reuse index space grows with them. Generational reuse and an `Unused`-driven
  GC are deferred.
- The retrofit is a single large change across the render pipeline (the four registries, their render
  caches, the `MeshAllocator` boundary, and the handle-bearing components). The index-primary keying
  decision is the mitigation: the draw-time key stays a `number` (`handle.index`), the allocator's
  free/slice paths are unchanged, and the render caches keep their `Map<AssetIndex, RenderT>` shape,
  so the blast radius is type renames and the handle wrapper rather than a re-architecture of draw.
  The change is gated on the full test suite plus `bench:check` showing no draw-time regression.
- The persistent GUID tier is designed but not built here, so on-disk reference stability and the
  studio browser are not yet exercised by a real consumer; the model is sealed so that work is
  additive.

## Implementation

Code lands through the phased backlog (`assets-core-types`, then `asset-server-and-loaders`, then
`asset-retrofit`); the persistent/studio tier is a later initiative. Governed surface:

- `packages/assets/src/index.ts` — re-export entry. Concern files: `asset-id.ts` (`AssetIndex`,
  `AssetGuid`, `AssetId`), `handle.ts` (`Handle`), `assets.ts` (`Assets<T>`: `add`, `get`, `getMut`,
  `insert`, `remove`, `reserveHandle`, `drainEvents`), `events.ts` (`AssetEvent<T>`),
  `importer-registry.ts` (`AssetImporterRegistry`), `serializer-registry.ts`
  (`AssetSerializerRegistry`), `source.ts` (`AssetSource`), `manifest.ts` (`AssetManifest`).
- `packages/engine/src/asset/` — `asset-server.ts` (`AssetServer`), `asset-plugin.ts` (`AssetPlugin`),
  `load-drain.ts` (the `PreUpdate` drain system), `fetch-source.ts` (`FetchAssetSource`).
- Retrofit (absorb existing types; key on `handle.index`):
  `packages/engine/src/image/{images.ts, image-plugin.ts, render-image.ts}`,
  `packages/engine/src/mesh/{meshes.ts, mesh-plugin.ts, allocator.ts, mesh-3d.ts, mesh-2d.ts}`,
  `packages/engine/src/material/{materials.ts, render-materials.ts, material-plugin.ts, mesh-material-3d.ts}`,
  `packages/engine/src/material2d/{materials-2d.ts, render-materials-2d.ts, material-2d-plugin.ts, mesh-material-2d.ts}`,
  `packages/engine/src/sprite/{texture-atlas-layout.ts, texture-atlas-layouts.ts, texture-atlas.ts, atlas-sync.ts}`,
  `packages/engine/src/core-plugin.ts`, and the `packages/engine/src/index.ts` re-exports.

## Research citations

- Bevy `AssetId<A>` (`Index` vs `Uuid`): <https://docs.rs/bevy/latest/bevy/asset/enum.AssetId.html>
- Bevy `Handle<A>` (strong = `Arc`, lifetime): <https://docs.rs/bevy/latest/bevy/asset/enum.Handle.html>
- Bevy `Assets<A>` (`add` → runtime id, `get_mut` → `Modified`, `remove`, `reserve_handle`): <https://docs.rs/bevy/latest/bevy/asset/struct.Assets.html>
- Bevy `AssetEvent<A>` (`Added`/`Modified`/`Removed`/`Unused`/`LoadedWithDependencies`): <https://docs.rs/bevy/latest/bevy/asset/enum.AssetEvent.html>
- Bevy `AssetServer` (immediate handle, async load, hot-reload / `watch_for_changes`): <https://docs.rs/bevy_asset/latest/bevy_asset/struct.AssetServer.html>
- Unity `.meta` GUID (assigned on import, survives move/rename, refs by GUID not path): <https://docs.unity3d.com/Manual/AssetMetadata.html>
- Unity `AssetDatabase` import pipeline (source ↔ imported sync): <https://docs.unity3d.com/Manual/AssetDatabase.html>
- Unity `AssetDatabase.CreateAsset` (promote in-memory object → persisted asset): <https://docs.unity3d.com/ScriptReference/AssetDatabase.CreateAsset.html>
