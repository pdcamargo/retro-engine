# ADR-0089: On-disk formats — YAML content, TOML config, `.meta`-sourced manifest

- **Status:** Accepted
- **Date:** 2026-06-19
- **Supersedes:** ADR-0070

## Context

ADR-0070 defined the project save tier — a swappable `AssetSink`, a pure-data
`serializeProject`, `.meta` sidecars, and a `.retro-project` layout — with everything
encoded as **JSON**: scenes were `.scene` JSON, the project index was `project.json`, and
a **committed `assets.manifest.json`** was the GUID→location source of truth.

The Standalone Studio initiative revisits the on-disk *formats* (not the write-tier
architecture, which stands). Two problems with the JSON-everywhere choice surfaced once a
human authors and version-controls these files:

- **Authored content (scenes, prefabs) wants a human format.** JSON is noisy to hand-edit
  and diff. The serialized payload is the reflection-emitted `SceneData` object graph;
  its text encoding is incidental.
- **A committed manifest is brittle.** A hand-/tool-maintained `assets.manifest.json` is a
  central bookkeeping file that merge-conflicts and drifts from what is actually on disk.
  Asset identity is better pinned to each asset (the `.meta` sidecar already does this);
  the manifest is a derived index.

The project descriptor and settings, by contrast, are human-readable *config* — TOML's
domain (`Cargo.toml`/`pyproject.toml` idiom), distinct from opaque machine state.

## Decision

- **Authored content → YAML, branded extensions.** Scenes are `*.rescene`, prefabs are
  `*.reprefab`, both UTF-8 YAML. The `SceneData` / `SerializedEntity` /
  `SerializedComponent` shapes are unchanged — only the text codec swaps. The extension is
  a *type tag* dispatched by the importer registry, so the internal encoding stays
  swappable without renaming files or references.
- **Project descriptor + settings → TOML.** The branded root marker `project.retroengine`
  (TOML) replaces `project.json`; per-concern settings live in `editor/settings/*.toml`,
  each mapping 1:1 to a reflectable resource (ADR-0069). The reflection codec still
  emits/consumes plain objects; TOML is only the text boundary.
- **Machine state → JSON; the manifest is generated, never committed.** `.meta` sidecars
  (`{ version, guid, kind }`) are the **committed source of truth** for asset identity. The
  GUID→`{location, kind}` manifest is rebuilt by scanning `.meta` files at project open
  (`scanMetaManifest`), satisfying the existing `loadManifest`/`loadByGuid` contract, and
  is **baked** into the bundle only on export. The engine read path (ADR-0066) is
  unchanged — only the authoring project drops the committed manifest.
- **The ADR-0070 write-tier architecture is retained**: `AssetSink`, pure-data
  `serializeProject`, promotion, `.meta` baking, DI-injected sink. This ADR changes only
  the text formats and the manifest's provenance.

## Consequences

- Scenes/prefabs/settings are reviewable and diffable; assets live in any folder with a
  committed `.meta`, and there is no central manifest to conflict on.
- New shipped deps in the engine/assets layer: `yaml` (eemeli) and a TOML library. JSON is
  a YAML subset, so existing JSON scene fixtures parse unchanged through the YAML importer.
- Two new format versions/extensions to migrate any pre-existing JSON projects. Pre-0.1.0,
  nothing is published, so no migration tooling ships.
- Implemented incrementally: the YAML scene codec lands first; the TOML descriptor,
  `scanMetaManifest` manifest model, and the `.reprefab` prefab asset kind follow. This
  Implementation section tracks what has landed.

## Implementation

- `packages/engine/src/scene/scene-importer.ts` — `createSceneImporter` / `createSceneSerializer` (YAML) — **landed**
- `packages/engine/src/scene/scene-plugin.ts` — registers the `rescene` loader — **landed**
- `packages/engine/src/save/serialize-project.ts` — scene bytes via YAML — **landed**
- `packages/engine/package.json` — `yaml` dependency — **landed**
- `packages/engine/src/save/scan-manifest.ts` — `scanMetaManifest` (rebuild manifest from `.meta`) — **landed**
- `packages/engine/src/save/meta.ts` — `.meta` carries `kind` (identity source of truth) — **landed**
- `packages/engine/src/save/serialize-project.ts` — drops the committed manifest + `project.json`; returns `scenes`/`manifest` — **landed**
- `project.retroengine` TOML descriptor + `editor/settings/*.toml` (the human-authored descriptor; owned by `create-project`/studio, not `serializeProject`) — _pending_
- `.reprefab` prefab asset kind/importer — _pending_
