# Assets core types — `packages/assets` leaf

- **Created:** 2026-05-31

## Context

Phase 1 of the asset system (ADR-0055), and the smallest safe slice: stand up the new
`packages/assets` leaf package with the identity primitives and the generic store, with **zero**
engine dependency and **no** change to any existing package. Nothing is retrofitted yet; this phase
only adds the types the later phases build on.

Surface to build (one concern per file, §5.5):

- `asset-id.ts` — `AssetIndex` (branded `number`), `AssetGuid` (branded `string`, v4 UUID),
  `AssetId<T>` discriminated union (`{ kind: 'runtime', index }` | `{ kind: 'guid', guid, index }`),
  plus v4 generation and the index→key accessor used by stores.
- `handle.ts` — `Handle<T>` value object: `index: AssetIndex`, optional `guid: AssetGuid`, phantom
  `T`. Cheap, equality by index, no lifetime behavior.
- `assets.ts` — `Assets<T>` store over `Map<AssetIndex, T>`: `add(value) → Handle<T>` (mints a
  monotonic runtime index), `get(handle) → T | undefined`, `getMut(handle)` (returns mutable value
  and queues `Modified`), `insert(handle, value)`, `remove(handle)` (queues `Removed`),
  `reserveHandle()` (reserve an index with no value yet, for async load), `drainEvents()`.
- `events.ts` — `AssetEvent<T>` union: `Added` | `Modified` | `Removed` | `Unused`, each carrying the
  handle. (`Unused` is emitted for tooling only; nothing frees on it — ADR-0055 §2.)
- `importer-registry.ts`, `serializer-registry.ts` — registry **types** only (strategy records); no
  wiring.
- `source.ts`, `manifest.ts` — `AssetSource` interface and `AssetManifest` type only (designed in
  ADR-0055 §4; concrete sources land in the next phase / later initiative).

Mirror the existing `Meshes` / `Images` registry idiom (`add`/`get`/`drainPendingChanges`) — this
store generalizes it. The branded-`number` handle the engine uses today *becomes* `AssetIndex`.

## Why deferred

Sequencing only — it is the foundation the other two phases consume. Kept its own PR so the id/handle
decisions land reviewed and unit-tested in isolation before any engine code depends on them.

## Acceptance

- New `packages/assets` package builds and type-checks; it is a leaf (no internal deps), and engine
  build is unchanged (it does not yet import it).
- `Handle<Mesh>` is not assignable to `Handle<Image>` (phantom brand enforced — a type-level test).
- Unit coverage for: monotonic runtime-index minting; `getMut` queues exactly one `Modified`;
  `remove` queues `Removed`; `reserveHandle` yields a resolvable-later handle; `drainEvents` drains
  once and clears.
- `lint` / `test` / `build` green; changeset present (new package, additive).
- No behavior change anywhere outside `packages/assets`.
