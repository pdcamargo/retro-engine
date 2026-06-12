# ADR-0071: Scene composition (nested scenes)

- **Status:** Accepted
- **Date:** 2026-06-12

## Context

Scenes-as-assets (ADR-0062), the reactor that instantiates a `SceneRoot` under an entity and re-parents the scene's top-level entities beneath it, automatic GUID handle resolution (ADR-0065), the manifest load-by-GUID read path (ADR-0066), prefab templates/patches (ADR-0067), inline observer binding (ADR-0068), and the persistent save tier (ADR-0070) are all in place. `scenes-and-prefabs.md` phase 6 asks for the next capability: **a parent scene includes other scenes as nested entities**, so a level is built by stitching together rooms / encounters / NPCs without duplicating their definitions.

ADR-0067 chose *one-shot, baked* semantics for templates — a template ref expands to components at spawn and serialization re-emits the expanded components, never the ref — and explicitly deferred the alternative: "A live prefab link / 'revert to prefab' is a separate future ADR with a provenance component, not built here." Scene composition is the consumer that forces that decision, because the whole point of nesting one scene inside another is that the child stays an **independent, editable asset**: edit the child `.scene` and every parent that includes it reflects the change. That is the Godot *instanced scene* / Unity *nested prefab* model, and it is the model an editor needs. So composition is a **live link by reference**, the opposite of a baked template expansion — the two coexist as distinct mechanisms.

The mechanics to reuse already exist and must not be re-invented: the `SceneRoot` component + the `update`-frame reactor (`addSceneInstantiation`) that polls the `Scenes` store, spawns the child graph through `spawnScene`, and re-parents its top-level entities under the root so a single despawn tears the instance down; GUID→`Handle<Scene>` resolution via `AssetServer.loadByGuid` (which also kicks the file load) or a caller-injected `resolveHandle`; and `spawnScene`'s two-pass, Commands-driven discipline.

## Decision

1. **A nested scene is a per-entity reference by GUID, not an inlined copy.** `SerializedEntity` gains an optional `scene?: SerializedSceneRef` where `SerializedSceneRef = { guid: string }`. The field is additive and optional, so `SCENE_FORMAT_VERSION` stays `1`, existing scenes are byte-identical, and the importer's strict version check is unaffected — the same additive move `templates`, `observers`, and `resources` made. The nesting entity carries its own components normally (its `Transform` positions the whole instance, a `Name` labels it); the `scene` ref is additive on top.

2. **Composition reuses `SceneRoot` and the reactor — it is not a parallel spawn path.** In `spawnScene` pass 2, an entity with a `scene` ref resolves the child `Handle<Scene>` and gets a `SceneRoot` attached through the command buffer. Resolution prefers a caller-injected `resolveHandle('Scene', guid)` (tools/tests, in-memory children); with none, it falls back to `AssetServer.loadByGuid<Scene>(guid)`, which returns the handle immediately **and** kicks the child file's load. The injected resolver is propagated onto the nested `SceneRoot` so the whole subtree resolves the same way. The existing reactor then instantiates the child under the nesting entity on a later frame, re-parenting as it already does. **Nesting recurses for free**: a child's own `scene` refs become `SceneRoot`s when it spawns, which the reactor picks up next — loading lazily, one depth level per frame. Teardown is the existing cascade: despawning an ancestor root cascades through the re-parented subtree, tearing nested instances down with it; observer cleanup rides the same despawn.

3. **Cycles are refused, statelessly, from the hierarchy.**  Before instantiating a `SceneRoot` for scene GUID `G`, the reactor walks the entity's `Parent` chain collecting the GUID of every ancestor `SceneRoot`; if `G` is already among them the instance is refused with a dev error rather than spawned (a self- or transitive-include cycle would otherwise spawn unboundedly across frames). No cycle state is stored on `SceneRoot` — the live hierarchy already encodes the ancestor chain, because each nested instance is re-parented under its nesting entity.

4. **Composition by GUID requires a manifest (or an injected resolver).** `AssetServer.loadByGuid` needs the GUID→location manifest (ADR-0066). An App that loads scenes by bare path without a manifest must supply `resolveHandle` to resolve nested children — the same override scenes already accept for asset handles. This is consistent with GUID being the persistent cross-file identity (ADR-0065): a nested reference is persistent, so it is a GUID, not a path.

5. **Serialization re-emits the reference and excludes the child's entities.** A nesting entity is recognized on save by carrying both `SceneRoot` and `SceneInstance` (the reactor records `SceneInstance` once it has spawned the child). `serializeScene`/`serializeWorld` emit such an entity with its registered components **plus** `scene: { guid }` taken from the `SceneRoot` handle's GUID, and **exclude** every entity in that instance's `SceneInstance.entities` from the output — they belong to the child `.scene` file, not this one. A nested instance whose handle has no GUID has no persistent identity to reference: its entities are excluded and no ref is emitted (it is runtime-only), mirroring how a GUID-less asset handle is dropped on save. `SceneRoot`/`SceneInstance` themselves stay transient/non-serialized (ADR-0062) — only the derived `scene` ref persists.

6. **Per-instance field-level overrides into a nested scene are deferred.** This slice ships the live link with no override layer: a composed child is positioned and parented by its nesting entity, but its internal entities are not patched per instance. Overriding a field on a nested scene's entity (Godot's *editable children* / Unity's prefab-instance overrides) needs the provenance component ADR-0067 named — which fields are inherited vs overridden, tracked across save/load — and lands when the editor drives it. Tracked in `docs/backlog/`.

## Consequences

- A level can be assembled from independently-authored scenes (`{ scene: { guid } }` per room/encounter/NPC), and editing a child scene propagates to every parent that includes it — the editor-facing nested-asset model, delivered without a new spawn path: composition is `SceneRoot` + the existing reactor, so Required Components, hierarchy wiring, lifecycle hooks, and cascade teardown all come for free.
- Loading is lazy and depth-incremental: each nesting level instantiates one frame after its parent, and a child file is fetched on demand via `loadByGuid` when its parent instance spawns. The accepted cost is that a deeply-nested scene is not fully present the frame its top-level root resolves; a loading screen waits on `AssetServer.settle` as it already does.
- The live link is the deliberate opposite of ADR-0067's baked template: a composed child round-trips as a reference (parent file stays small, child stays editable), whereas a template ref bakes to components. Two mechanisms, clearly separated — a scene authors a `scene` ref when it wants a live link, a `templates` ref when it wants a one-shot expansion.
- Cycle refusal makes a self-including scene a clean dev error instead of an unbounded spawn loop; the check is O(depth) per instantiation, paid once per nested root, not per frame.
- Composition-by-GUID requires a manifest in production; path-only apps must inject `resolveHandle`. Accepted: GUID is already the persistent reference identity.
- No bench: scene instantiation is one-shot at load, and the reactor's steady-state query (`SceneRoot` `without SceneInstance`) is empty once everything is instantiated; the `Parent`-chain cycle walk runs only at instantiation (CLAUDE.md §11 — one-shot setup, not a per-frame hot path).
- Per-instance overrides remain unbuilt; a scene can nest another but cannot yet tweak the nested entities' fields. Deferred deliberately to the provenance ADR, not stubbed.

## Implementation

- `packages/engine/src/scene/scene-data.ts` — `SerializedSceneRef`, `SerializedEntity.scene`
- `packages/engine/src/scene/spawn.ts` — `resolveSceneRef` + nested `scene`-ref handling in pass 2 of `spawnScene` (resolve child handle, attach `SceneRoot`, propagate `resolveHandle`)
- `packages/engine/src/scene/scene-reactor.ts` — `wouldCycle` `Parent`-chain ancestor-GUID check before instantiation (refused roots marked with an empty `SceneInstance`)
- `packages/engine/src/scene/serialize.ts` — `collectComposition`: nested-mount detection, `scene` ref emission, exclusion of `SceneInstance` members
- `packages/engine/src/index.ts` — `SerializedSceneRef` re-export
- `packages/engine/src/scene/scene-composition.test.ts` — instantiate + name/position, same-scene-N-times, round-trip (ref preserved, child entities excluded, reload re-instantiates), cycle refusal, cascade teardown
- `apps/playground/src/composition-showcase-plugin.ts`, `apps/playground/src/main.ts` — `?mode=compose` device check (a Level scene nesting the same Pillar child twice)
- Builds on ADR-0062 (`SceneRoot`, the reactor, `Scenes`), ADR-0065/0066 (`loadByGuid`, GUID resolution), and ADR-0067 (the baked-template counterpart it deliberately contrasts). Supersedes none.
