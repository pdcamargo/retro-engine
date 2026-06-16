# ADR-0079: Editor world introspection (outline + component-list readers)

- **Status:** Accepted
- **Date:** 2026-06-16

## Context

The studio's Hierarchy and Inspector panels were built against a mock authoring
model (`apps/studio/src/scene-data.ts`) keyed by string ids, fully disconnected
from the live ECS world the engine actually spawns into. To show real entities
and their components, the editor needs a read path from a running `World` (plus
the App's reflection registry) into view-models the panels can draw — and that
path must handle every hierarchy the engine produces (authored scenes, prefab
expansions, nested scene instances, imported glTF node graphs) uniformly, since
they all land as plain entities linked by the same `Parent` edge.

`docs/roadmap/editor-sdk.md` already names this as the SDK's Phase 6, "engine
introspection — read-only access to the running App for editor-side queries", and
`@retro-engine/editor-sdk` already depends on `@retro-engine/engine`.

## Decision

- **The introspection readers live in `@retro-engine/editor-sdk`**, as UI-agnostic
  functions over `(World, TypeRegistry)` that return plain view-models. The panels
  (in the studio) map those view-models onto existing widgets. Data-reading and
  widget-drawing stay separated by file (CLAUDE.md §5.5), not by package — the
  package boundary that would justify a split does not exist while editor-sdk is
  the only consumer and already depends on the engine. If a non-ImGui consumer of
  the readers ever appears, they extract into a leaf `editor-world` package, and
  that extraction is its own ADR.
- **`buildOutline(world, opts?)`** flattens the world into depth-tagged
  `OutlineNode`s by walking the `Parent` edge (the source of truth, so it reflects
  whatever spawned each entity), with `isOpen`/`skip` predicates for collapse and
  pruning, and an **extensible `EntityClassifier` chain** (first match wins) that
  picks an icon/kind per entity. editor-sdk ships engine-known classifiers
  (camera/light/mesh/scene-mount); a consumer prepends its own (the studio prepends
  a glTF matcher, since editor-sdk does not depend on `@retro-engine/gltf`).
- **`listComponents(world, registry, entity)`** returns each attached component as
  a `ComponentEntry` tagged serializable (has a reflection schema, via
  `registry.getByCtor(ctor).name`) or derived (no schema — recomputed/reciprocal).
  Serializable first. Known engine derived components get stable labels; unknown
  unregistered ones fall back to the constructor name (debug-only).
- **The studio keeps selection and expand state on `StudioState`, keyed by
  `Entity`** (`selectedEntity`, `collapsed`), because the tree model is rebuilt
  each frame and cannot hold per-node state. The inspector shows the serializable
  set by default and reveals the derived set behind a `debugMode` toggle, mirroring
  the engine's authored-vs-derived distinction (ADR-0061).

## Consequences

- The Hierarchy and Inspector now reflect the real world, including nested-scene
  mounts and glTF node trees, with no per-mechanism special-casing — one walk plus
  a classifier chain. Rebuilding per frame is cheap for small/mid worlds;
  change-detection-gated rebuilds are a later optimization if large worlds need it.
- This delivers the "selection backed by real ECS entities" prerequisite that
  `docs/backlog/gizmo-selection-bridge.md` was blocked on; viewport ray-picking and
  single-gizmo-from-selection remain in that backlog item.
- editor-sdk gains `@retro-engine/ecs` and `@retro-engine/reflect` as (honest,
  type-level) dependencies — it is the editor introspection SDK, and reflection is
  the mechanism.
- Selection keyed by raw `Entity` will not survive a play/stop world swap (ids
  differ); a stable editor identity is required when playmode lands (tracked in
  `docs/backlog/studio-playmode-snapshot-restore.md`).
- The studio's mock `scene-data.ts` still feeds the untouched panels (assets /
  console / systems); only the hierarchy + inspector moved to the live world.

## Implementation

- `packages/editor-sdk/src/world-outline.ts` — `buildOutline`, `OutlineNode`, `BuildOutlineOptions`, `EntityClass`, `EntityClassifier`, `defaultClassifiers`
- `packages/editor-sdk/src/component-list.ts` — `listComponents`, `ComponentEntry`
- `packages/editor-sdk/src/index.ts` — re-exports of the above
- `apps/studio/src/panels-left.ts` — `hierarchyPanel` (live tree consumer)
- `apps/studio/src/panels-inspector.ts` — `inspectorPanel` (live component-name consumer + debug toggle)
- `apps/studio/src/entity-classifiers.ts` — `studioClassifiers` (glTF matcher prepended to defaults)
- `apps/studio/src/state.ts` — `selectedEntity`, `collapsed`, `debugMode`
