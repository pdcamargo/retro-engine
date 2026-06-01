---
'@retro-engine/assets': minor
'@retro-engine/engine': minor
---

feat(assets): LoadContext + dependency-aware loading

Widens the importer context so a single importer can pull in related resources and register the sub-assets a composite file decodes into — the prerequisite for multi-file formats (a model with external buffers/images, an atlas with a sidecar).

**Public surface (`@retro-engine/assets`, re-exported from `@retro-engine/engine`):**

- `LoadContext` replaces `AssetImportContext`. It keeps `path` and adds:
  - `read(relativePath): Promise<Uint8Array>` — read a resource referenced relative to this asset, resolved against the directory of `path` and fetched through the same source the root load used. A `data:` URI is decoded inline and never hits the source. The importer awaits these reads, so an asset is not loaded until its dependencies resolve.
  - `addLabeledAsset<U>(label, value, store): Handle<U>` — register a decoded sub-asset into `store` and get its handle back to wire into the composite value. The store is passed explicitly, keeping the server asset-type-agnostic.
- `AssetImporter<T>` now receives a `LoadContext`. The change is additive: existing single-file importers (which read only `ctx.path`) compile and behave unchanged.

**Behaviour (`AssetServer`):**

- `runLoad` constructs the `LoadContext`. Sibling paths resolve by string join against the path's directory (source-agnostic — no `new URL`), so a source's own base resolution composes on top.
- Sub-assets reserve a handle immediately (no event queued) and buffer locally; on importer resolution the whole subgraph — sub-assets before root — is committed in one `PreUpdate` drain pass, before the render stage extracts any of it.
- Failure stays all-or-nothing: a throwing importer commits no partial subgraph; reserved sub-asset slots are simply never filled; `AssetLoadFailure` records the error unchanged.
