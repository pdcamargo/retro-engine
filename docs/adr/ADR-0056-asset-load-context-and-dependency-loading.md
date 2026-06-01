# ADR-0056: Asset Load Context and Dependency-Aware Loading

- **Status:** Accepted
- **Date:** 2026-06-01

## Context

ADR-0055 sealed the runtime asset core: `Assets<T>`, `Handle<T>`, `AssetEvent<T>`, an
`AssetServer` with immediate-handle + schedule-bound drain, and an importer registry mapping a
file extension to an importer **function**. The importer contract is:

```ts
type AssetImporter<T> = (bytes: Uint8Array, ctx: AssetImportContext) => T | Promise<T>;
interface AssetImportContext { readonly path: string; }
```

That contract assumes a **single, self-contained file**: the server reads one path's bytes,
hands them to the importer, and the importer returns one value. Two capabilities are missing the
moment a format spans more than one file:

1. **No sibling reads.** An importer receives only `bytes` and `path`. It has no way to ask the
   `AssetSource` for a *related* resource — a `.gltf`'s external `.bin` buffer, an image referenced
   by relative URI, a sidecar next to a sprite sheet. The `AssetSource` is held privately by the
   `AssetServer` and never reaches the importer.
2. **No sub-asset registration, and no "ready when the graph is."** A composite file decodes into
   several addressable assets (a glTF yields N meshes, N materials, N images). There is no way for
   an importer to register those sub-assets into their stores and get handles back, and no way to
   keep the composite *root* unready until every dependency it pulled in has resolved.

The load path also imposes a hard correctness constraint that any solution must respect.
`AssetServer.runLoad` runs the importer **off-schedule** (inside a promise), pushes the result onto
a `completed` buffer, and a `PreUpdate` system (`applyCompletedLoads`) performs the `Assets.insert`
calls synchronously, before `RenderSet.Extract`. `Assets.insert` is **not** a pure map write — it
queues an `AssetEvent` onto the store's per-frame event buffer, which a single schedule-bound system
drains each frame. The whole design forbids mutating any store from the off-schedule promise;
`load-drain` upholds the guarantee that a load completed this frame is visible to extraction in the
same frame. Any multi-asset scheme must commit through that same on-schedule drain, or it breaks the
ordering the renderer depends on.

This decision is the general prerequisite for the glTF importer (ADR-0057), but it is deliberately
format-agnostic: it is the reusable async-dependency capability that any future multi-file format —
scene bundles, atlas-with-sidecar, multi-part audio — builds on.

## Decision

### 1. Widen the import context into a `LoadContext`

The importer still receives `(bytes, ctx)`; `ctx` gains two members. The widening is additive —
existing importers that read only `ctx.path` are unaffected.

```ts
interface LoadContext {
  readonly path: string;
  read(relativePath: string): Promise<Uint8Array>;
  addLabeledAsset<U>(label: string, value: U, store: Assets<U>): Handle<U>;
}
```

- **`read(relativePath)`** resolves a sibling resource relative to the **directory of `path`** and
  reads it through the same `AssetSource` the root load used. An importer awaits these reads as part
  of its returned promise.
- **`addLabeledAsset(label, value, store)`** registers a decoded sub-asset into its target store and
  returns a `Handle<U>` the importer can wire into the composite root. The target `store` is passed
  explicitly so the `AssetServer` never needs to name concrete stores — it stays asset-type-agnostic,
  exactly as ADR-0055 §8 requires. The owning plugin closes over the store references when it builds
  its importer (e.g. the glTF plugin captures `Meshes`, `Materials`, `Images`). The `label` is a
  human-meaningful identifier (`"Mesh0"`, `"Material0/baseColor"`) used for diagnostics and as the
  key a future sub-asset *addressing* layer can reference; it is not itself an addressing mechanism
  in this decision.

### 2. Sub-asset commits are atomic and on-schedule (the correctness core)

`addLabeledAsset` does **not** insert into the store. Inserting off-schedule would queue an
`AssetEvent` at an arbitrary microtask time and let a sub-asset become visible to `Extract` in a
frame where its composite root is not yet present — the exact ordering violation the load-drain
guarantee exists to prevent. Instead:

- `addLabeledAsset` calls `store.reserveHandle()` (synchronous, queues **no** event), records the
  triple `{ store, handle, value }` into a buffer **local to the current load**, and returns the
  handle immediately so the importer can reference it while still decoding.
- When the importer's promise resolves, `runLoad` pushes **all** of that load's triples — every
  sub-asset plus the root — onto the server's `completed` buffer.
- `applyCompletedLoads` already iterates `completed` and calls `store.insert` on each; it is agnostic
  to which store. Because it runs as one synchronous pass inside a single `PreUpdate`, every `Added`
  event for the whole subgraph is queued in the same frame, before any `Extract`. Sub-asset events
  are ordered before the root's within that pass (harmless given they share a frame, but tidy for any
  consumer that assumes leaf-before-composite).

The "root is ready only when its dependency graph has resolved" property then falls out for free:
the importer's promise does not resolve until its `read`/decode work is done, and nothing is inserted
until that resolution drains. No load-state machine, pending-count, or `LoadedWithDependencies` event
is needed in the `AssetServer`.

### 3. Failure is all-or-nothing

The per-load triple buffer lives in the `runLoad` invocation, not in shared server state. If the
importer throws (a bad `read`, a malformed file, an unsupported required feature), nothing was pushed
to `completed`, so no partial subgraph leaks into any store. The reserved sub-asset indices are simply
never filled — the same wasted-index cost as a failed root load today. The existing `AssetLoadFailure`
(`{ path, handle, error }`) records the failure unchanged.

### 4. Sibling-path resolution is source-agnostic

`read(relativePath)` resolves against `dirname(path)` using a **string join**, then passes the result
to `AssetSource.read`. It must **not** use `new URL(...)`, which would assume a URL-shaped source and
break the (designed-but-deferred) disk and bundle sources. `FetchAssetSource`'s own `baseUrl`
resolution composes on top of the joined path, so the two layers stack correctly. Percent-encoded URIs
are decoded before the join; `data:` URIs short-circuit (base64-decoded inline, never hitting
`AssetSource.read`).

## Consequences

**Easier.** Multi-file formats become expressible without touching the `AssetServer`'s core: an
importer reads its siblings, registers its parts, and returns a composite root, and the existing drain
commits the whole graph atomically and in order. The importer signature stays additive, so every
existing single-file importer is untouched. The capability is reusable — glTF is the first consumer,
not the only one.

**Harder / accepted trade-offs.**

- Hot-reload of a *dependency graph* (re-reading a `.gltf` and diffing its sub-assets behind stable
  handles) is not addressed here. Single-asset hot-reload via `Modified` still works; graph-aware
  reload, and a Bevy-style `LoadedWithDependencies` event, remain future work layered on this base.
- A long-running load holds its reserved sub-asset handles until it resolves or fails. A load that
  never settles leaks those reserved indices — the same exposure as a never-settling root load today.
- `addLabeledAsset` taking an explicit `store` keeps the server agnostic but pushes store-wiring onto
  the consuming plugin. That is the intended boundary (the server must not know about `Meshes` or
  `Images`), accepted as a small ergonomic cost in the importer-construction code.

## Implementation

- `packages/assets/src/importer-registry.ts` — widen `AssetImportContext` into `LoadContext`
  (`read`, `addLabeledAsset`); keep `AssetImporter<T>` signature shape.
- `packages/engine/src/asset/asset-server.ts` — construct the `LoadContext` in `runLoad` (the `read`
  closure over `AssetSource` + the sibling-path resolver; the `addLabeledAsset` closure over the
  per-load triple buffer); push all triples onto `completed` on resolution; preserve all-or-nothing
  failure.
- `packages/engine/src/asset/load-drain.ts` — `applyCompletedLoads` already inserts each
  `CompletedLoad` into its `store`; confirm it commits a load's full set in one pass.

## Research citations

- glTF buffers / external `.bin` / relative URIs (why sibling reads are needed):
  <https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#buffers-and-buffer-views>
- glTF data URIs (base64-inline buffers/images that short-circuit `read`):
  <https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#uris>
- Bevy `LoadContext` (precedent: an import-time context exposing dependency loads + labeled
  sub-assets): <https://docs.rs/bevy/latest/bevy/asset/struct.LoadContext.html>
- Bevy `AssetEvent::LoadedWithDependencies` (the graph-ready signal we deliberately do not need):
  <https://docs.rs/bevy/latest/bevy/asset/enum.AssetEvent.html>
