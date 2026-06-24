# ADR-0111: Asset-kind registry and on-discovery sidecar generation

- **Status:** Accepted
- **Date:** 2026-06-23

## Context

`.meta` sidecars are the source of truth for asset identity ([ADR-0089](ADR-0089-on-disk-formats-yaml-toml-meta.md)): the manifest is rebuilt by scanning them (`scanMetaManifest`), not from a committed file. But sidecars were only ever written by a project **save** (`serializeProject` → `promoteAsset`). Nothing minted a sidecar for a raw asset a user drops into a project, so a loose `.glb` (or `.png`) never entered the manifest and never appeared in the studio asset browser. A secondary gap: the browser's kind→UI-type mapping was a hard-coded switch with no glTF case, so even a glTF with a sidecar rendered as a generic folder.

Adding a new asset type also meant editing ~11 scattered places (the UI `AssetType` union, the browser `typeFor` switch, the watch-router extension regex, the loader registry, a serializer, etc.) with no single declaration point — every addition was a reverse-engineering exercise.

Two placement questions had to be settled: where the catalog of asset kinds lives without violating package dependency rules ([CLAUDE.md §5.3](../../CLAUDE.md)), and whether sidecar generation should run in the Rust/Tauri layer or in TypeScript.

## Decision

- **A central `AssetKinds` catalog**, a main-world resource mirroring `MaterialTypes` in shape and lifecycle. Each kind-owning plugin registers one `AssetKindDescriptor` in `build()` via `registerAssetKind`. A descriptor declares: the `kind` tag, claimed file `extensions`, whether the kind is `discoverable` (a loose file gets a sidecar minted), an optional `largeBinary` hint, an optional UI `category` string, and an optional `defaultMeta()` factory for the sidecar's `data` body. The catalog holds discovery + identity + UI metadata only; it does **not** duplicate the loader (`AssetServer`), serializer (`AssetSerializers`), or store (`AssetStores`) registries — those stay where they are.

- **The UI category is a plain string on the descriptor**, mapped to the editor's `AssetType` by the studio. The engine never imports `editor-sdk` (the dependency runs the other way), so the descriptor carries `category?: string` and the studio owns the `category → AssetType` table.

- **Sidecar generation lives in TypeScript (engine), not Rust/Tauri.** `generateMissingSidecars(files, kinds)` is a pure, idempotent function — no I/O — that returns the `.meta` writes for loose discoverable assets lacking a sibling sidecar. The studio writes them through its existing `AssetSink`. Rust stays the raw FS layer (list dir, read/write bytes, watch). The decisive reasons: the engine targets browser builds with no Rust at all; the kind↔extension catalog and default-meta factories are TS plugin registrations Rust cannot see; and it mirrors the existing pure `serializeProject` path rather than forking sidecar-writing across the language boundary.

- **Sidecars are minted eagerly on discovery** — at project open and on a live file-watch reindex — because a GUID must persist on disk or it would change every open and break references.

- **The `.meta` format gains an optional `data` field** (`AssetMetaData = Record<string, unknown>`), additive so the wire version stays `1` and `scanMetaManifest` (which reads only `guid`/`kind`) is untouched. Per-kind import settings and authored sub-asset data (e.g. a texture's sprite rect map) live here. The shape is owned by the kind, not the meta module. For now `defaultMeta` returns plain JSON; routing `data` through the reflection codec ([ADR-0060](ADR-0060-reflection-and-serialization.md)) for an inspector is the documented growth path.

## Consequences

- A loose `.glb`/`.gltf` or image dropped into a project is discovered, gets a stable GUID + sidecar, and shows in the asset browser with the correct icon — including live, without a reload, via the previously-stubbed watcher reindex handler.
- Adding a new asset type starts from one `registerAssetKind` declaration; the discovery and (via `category`) the browser classification follow from it. The remaining touchpoints (loader, serializer, UI icon/tone) are documented in the `add-asset-type` skill.
- `discoverable` is a deliberate per-kind decision: source assets a user authors externally (images, glTF) are discoverable; engine-authored outputs that only exist because a save wrote them with a sidecar (meshes, scenes, bundles, materials) are not — a loose one of those is a corruption, not a discovery.
- Several non-discoverable kinds may share an extension (materials share `.remat`, routed by kind); the registry tolerates that and only enforces uniqueness for discoverable extensions.
- A descriptor's `extensions` restates what the loader registry knows; if they drift, discovery could mint a sidecar for a file with no loader. Mitigated by registering both from the same plugin `build()`. The studio's watch-router still carries its own extension regex; deriving it from `AssetKinds.extensions()` is a tracked follow-up, not required for correctness.
- The studio registers the glTF descriptor directly (the full `GltfPlugin` runtime isn't in the editor's base plugin set), so the catalog is available to the pre-runtime asset-browser scan. Loading project glTF into scenes remains a separate concern.

## Implementation

- `packages/engine/src/asset/asset-kinds.ts` — `AssetKinds`, `AssetKindDescriptor`, `registerAssetKind`
- `packages/engine/src/save/meta.ts` — `AssetMetaFile.data`, `AssetMetaData`, `bakeMetaWithData`, `parseMeta`
- `packages/engine/src/save/generate-sidecars.ts` — `generateMissingSidecars`, `GenerateSidecarsResult`, `MintedSidecar`
- `packages/engine/src/{image,mesh,scene,bundle,sprite}/*-plugin.ts`, `packages/engine/src/material/material-plugin.ts` — `registerAssetKind` per owning plugin
- `packages/gltf/src/gltf-asset-kind.ts` — `GLTF_ASSET_KIND`, `gltfAssetKindDescriptor` (registered by `GltfPlugin`)
- `apps/studio/src/project/project-browser.ts` — `typeFor`/`buildBrowserAssets` consume `AssetKinds`
- `apps/studio/src/main.ts` — sidecar generation on project open + the file-watch reindex handler
