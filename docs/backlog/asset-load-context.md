# Asset load context & dependency-aware loading

- **Created:** 2026-06-01
- **Decision:** ADR-0056

## Context

The ADR-0055 importer contract is single-file: `(bytes, { path }) => T | Promise<T>`. An importer
cannot read sibling resources (the `AssetSource` is private to the `AssetServer`) and cannot register
sub-assets or keep a composite root unready until its dependency graph resolves. glTF (ADR-0057) — and
any future multi-file format — needs both. ADR-0056 seals the general extension; this item builds it.

## Why deferred

It is sequenced first within the glTF initiative (it is the prerequisite for every other glTF slice),
but it is its own slice because it touches the asset core (`packages/assets` + the engine asset path),
is format-agnostic, and is independently testable without any glTF code.

## Acceptance

- `AssetImportContext` is widened into `LoadContext` (`packages/assets/src/importer-registry.ts`) with
  `read(relativePath): Promise<Uint8Array>` and `addLabeledAsset<U>(label, value, store): Handle<U>`;
  the change is additive (existing single-file importers compile and behave unchanged).
- `AssetServer.runLoad` (`packages/engine/src/asset/asset-server.ts`) constructs the `LoadContext`:
  `read` resolves `relativePath` against `dirname(path)` via string-join (not `new URL`) and reads
  through the `AssetSource`; `data:` URIs short-circuit; `addLabeledAsset` reserves a handle (no event
  queued), buffers `{ store, handle, value }` in a load-local buffer, and returns the handle.
- On importer resolution, **all** of a load's triples (sub-assets + root) are pushed onto `completed`
  and committed by `applyCompletedLoads` in a single `PreUpdate` pass — every `Added` event queued the
  same frame, before `RenderSet.Extract`. A test proves a multi-asset load's sub-assets and root are
  all visible to extraction in the same frame (extend the `load-drain` ordering test).
- Import failure is all-or-nothing: a throwing importer commits no partial subgraph; the reserved
  sub-asset indices are simply never filled; `AssetLoadFailure` records the error.
- Lint, typecheck, test, build green; changeset added (touches `packages/*/src/**`).
