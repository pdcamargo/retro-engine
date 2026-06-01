---
'@retro-engine/engine': minor
---

feat(engine): retrofit the four asset registries onto the unified `Assets<T>` store (ADR-0055)

Replaces the four bespoke, hand-rolled asset registries (`Images`, `Meshes`, `Materials<M>`, `TextureAtlasLayouts`) and their branded-number handle types with the generic `Assets<T>` store and object `Handle<T>` from `@retro-engine/assets`. One store implementation, one handle type, one event channel across meshes, images, materials, and atlas layouts. The draw-time key stays a `number` (`handle.index`): render caches keep their `Map<AssetIndex, RenderT>` shape and the `MeshAllocator`'s free/slice paths are unchanged, so this is a type-and-keying change, not a re-architecture of draw.

**BREAKING — public surface changes:**

- Branded handle types `ImageHandle`, `MeshHandle`, `MaterialHandle<M>`, and `TextureAtlasLayoutHandle` are **removed**. Handle-bearing components (`Mesh3d`, `Mesh2d`, `MeshMaterial3d<M>`, `MeshMaterial2d<M>`, `TextureAtlas`, `Sprite.image` / `.normalMap`) and material texture fields (`StandardMaterial`, `UnlitMaterial`) now hold `Handle<T>` from `@retro-engine/assets`. A `Handle<T>` is an object `{ index, guid? }`, not a number — compare with `handleEq` (or `handle.index`), never `===` on the handle, and never use a handle object as a `Map` key (key on `handle.index`).
- The per-type change unions `ImageAssetEvent`, `MeshAssetEvent`, `MaterialAssetEvent<M>`, and `TextureAtlasLayoutAssetEvent` are **removed** in favour of `AssetEvent<T>`. `AssetEvent<T>` adds an `'unused'` variant alongside `'added' | 'modified' | 'removed'`.
- Store method renames inherited from `Assets<T>`: `drainPendingChanges()` → `drainEvents()`; `Images.replace(h, v)` / `TextureAtlasLayouts.replace(h, v)` → `insert(h, v)` (note: `insert` on an empty slot queues `'added'` and always writes, whereas `replace` was a no-op returning `false` on an unknown handle); `Meshes.mutate(h, fn)` / `Materials.mutate(h, fn)` → `getMut(h)` then mutate the returned value in place. `iter()` now yields `[AssetIndex, T]` rather than `[Handle, T]`.
- `Images`, `Meshes`, and `TextureAtlasLayouts` are now thin named subclasses of `Assets<T>` (the distinct constructor is what lets each coexist as a constructor-keyed ECS resource); `Materials<M>` is `extends Assets<M>` and keeps its per-type synthesized subclass machinery. The three well-known image defaults (`Images.WHITE`, `Images.BLACK`, `Images.NORMAL_FLAT`) remain seeded in the `Images` constructor, now typed `Handle<Image>`.
- `MeshAllocator`'s `allocateVertex` / `allocateIndex` / `freeVertex` / `freeIndex` / `vertexSlice` / `indexSlice` now take an `AssetIndex` (pass `handle.index`) instead of a branded `MeshHandle`.
- `AssetIndex` (type) and `asAssetIndex` are now re-exported from `@retro-engine/engine`.

No behaviour change to rendering: the playground renders meshes, sprites, and materials identically, and runtime `assets.add()` / hot-mutate-via-`getMut()` drive the expected GPU updates. The persistent-GUID tier of the model is designed but not exercised by this slice.
