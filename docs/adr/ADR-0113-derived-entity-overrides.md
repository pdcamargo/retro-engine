# ADR-0113: Derived-entity overrides (prefab-style instance edits)

- **Status:** Accepted
- **Date:** 2026-06-25
- **Supersedes:** ADR-0112

## Context

[ADR-0112](ADR-0112-plugin-extensible-scene-composition.md) made instantiated subtrees (a `GltfSceneRoot`'s `GltfInstanceNodes`, a nested `SceneRoot`) *derived*: excluded from a save and rebuilt on load from their source, with one escape hatch — an **authored** entity parented onto a derived node round-trips as a stable `attach` anchor. That left a hole: edits to the derived entities *themselves* do not persist. Hiding one child of an instantiated Armature, renaming a bone, nudging a node's transform, adding or removing a component, or deleting a node all work in the live editor but vanish on reload, because `serializeEntities` skips every excluded entity outright. Instancing a 3D model or nested scene is therefore read-only in practice — the opposite of what a prefab should be.

The fix must be **automatic** (the user edits a derived entity like any other; nothing to "mark" or "anchor" by hand), **general** (any current or future derived source benefits, not just glTF), and **non-destructive to the source** (the model file is not baked into the scene; only the deltas are stored). This is the prefab-override model that Unity (`PropertyModification` + added/removed components) and Godot (instance-local property overrides) already validate.

ADR-0112's seam and anchors are correct and are kept; this ADR builds the override layer on top of them, which is why it supersedes rather than amends.

## Decision

- **Baseline snapshot at instantiation.** Right after a subtree instantiates (and its required components resolve), the owning plugin captures each derived entity's *pristine* components — encoded — into a runtime-only `CompositionBaseline` on the mount, keyed by entity with its stable anchor. It is recomputed on every (re-)instantiation, so it is never serialized (a deliberate transient cache per [CLAUDE.md §13](../../CLAUDE.md)).

- **Save diffs live against baseline.** `serializeEntities` emits, on the mount's `SerializedEntity`, a `derived: SerializedDerivedOverride[]` recording only what changed, addressed by anchor: `set` (field-level patches to a component the source produced — only the changed fields, via `diffComponent`), `add` (a whole component the source lacked), `remove` (component type names deleted), `deleted` (the derived entity itself was removed — detected by a baseline entry whose entity is no longer alive). `Parent` is never diffed; structure is rebuilt by re-instantiation, and an authored child onto a node is still carried by `attach`. An untouched instance emits no `derived` key and serializes byte-identically to before.

- **Load re-applies after re-instantiation.** `spawnScene` stashes the mount's `derived` records as a runtime `PendingCompositionOverrides`. A generic engine system (`composition-override-apply`) waits until every anchor `kind` reports its subtree instantiated, resolves each anchor, and applies the deltas: `add` inserts (so required components resolve), `set` overlays changed fields, `remove` drops components, `deleted` despawns the node — re-homing any authored attachment that targeted it onto the mount so the user's attached entity is not lost. The mount's `PendingCompositionOverrides` is then removed.

- **Resolution is a separate `kind`-keyed seam.** `CompositionProvider` (save-side: exclusion + anchoring, App-only) is left unchanged; load-side resolution is a new `CompositionResolverRegistry` mapping an anchor `kind` to `{ instantiated, resolve }`. Keeping them separate means the generic apply system carries no plugin imports and a provider need not implement load-time methods. glTF registers a `gltf-node` resolver.

- **Granularity is field-level, reusing existing machinery.** `set` uses the same `SerializedOverride` + `applyFieldOverrides` the prefab-template path already uses, so a component the user did not touch still inherits source changes on re-import; only edited components are frozen.

- **Per-primitive mesh children are addressable.** A multi-primitive node spawns one mesh child per primitive — derived entities with no glTF node index. `GltfNodeAnchor` gains an optional `primitive` ordinal; `GltfInstanceNodes` records the full `derivedEntities` set so these children are excluded and resolvable (which also closes a latent dangling-`Parent` bug where they were neither).

## Consequences

- Editing an instanced glTF (or, once they register a resolver, any future derived source) now survives save/reload with zero user ceremony — the headline capability that was missing.
- Scenes stay small and non-destructive: only deltas are stored, and re-importing the source flows through to untouched fields/components of edited nodes.
- A model swap drops the baseline so it is recaptured against the new model; overrides self-heal (a delta the new model already satisfies diffs to empty) or persist via the path-based anchor.
- Accepted limitations: a deleted node re-spawns then despawns one frame late on load (matches `PendingAttachment` timing); entity-typed fields inside a *derived component's* override are not remapped across load (glTF node components have none — documented for future sources); diff is exact-equality on encoded values (no float epsilon), which is correct because both sides encode identically.

## Implementation

- `packages/reflect/src/codec.ts` — `diffComponent`, `FieldOverride`
- `packages/engine/src/scene/composition.ts` — `CompositionBaseline`, `CompositionBaselineEntry`, `PendingCompositionOverrides`, `CompositionResolver`, `CompositionResolverRegistry`
- `packages/engine/src/scene/scene-data.ts` — `SerializedDerivedOverride`, `SerializedEntity.derived`
- `packages/engine/src/scene/serialize.ts` — `deriveOverrides` (per-mount diff)
- `packages/engine/src/scene/spawn.ts` — stashes `PendingCompositionOverrides`
- `packages/engine/src/scene/composition-apply.ts` — `addCompositionOverrideApply` (`composition-override-apply` system)
- `packages/engine/src/core-plugin.ts` — inserts `CompositionResolverRegistry`, registers the apply system
- `packages/gltf/src/gltf-anchor.ts` — `GltfNodeAnchor.primitive`, primitive-child resolve/anchor
- `packages/gltf/src/gltf-components.ts` — `GltfInstanceNodes.derivedEntities`
- `packages/gltf/src/gltf-instantiate.ts` — `addGltfBaselineCapture`; baseline drop on re-instantiation
- `packages/gltf/src/gltf-attach.ts` — `gltf-node` resolver registration; rebind ordered after override-apply; excludes all derived entities
