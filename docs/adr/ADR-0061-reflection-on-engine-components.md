# ADR-0061: Reflection on engine components + hook-firing scene spawn

- **Status:** Accepted
- **Date:** 2026-06-02

## Context

Reflection v1 (ADR-0060) shipped `@retro-engine/reflect` and a world↔scene serializer, but it could only round-trip hand-authored test types into a bare `World`. ADR-0060 explicitly reserved two follow-ups: retrofitting real engine components into the registry, and an App/Commands hook-firing deserialize path. This ADR builds those — it does not change ADR-0060, which stays sealed.

Two gaps had to close together. First, no real component (`Transform`, `Name`, `Mesh3d`, …) was registered, so a live entity graph could not be saved. Second, the bare-`World` load bypasses the command flush where engine lifecycle hooks live, so Required Components are not pulled in through the hook path and — critically — a parent's `Children` is never rebuilt, because the reciprocal `Parent`↔`Children` wiring lives in the Commands `appendChild` op, not in a `World` insert.

Research (verified, not assumed):

- **Bevy `AppTypeRegistry`** is a `Resource` wrapping `TypeRegistry`, written at startup by plugins via `app.register_type::<T>()`, then read by reflect ops. It is per-App, not a process-wide global.
- **Bevy does not serialize computed components** such as `GlobalTransform` — "a computed type overwritten at runtime; no value in serializing it." Derived state is recomputed on load by propagation.
- **Bevy issue #23258**: `DynamicScene::write_to_world` does not fire the `ChildOf` `on_insert` hook, so the parent's `Children` stays empty and transform propagation never reaches the children. The fix in spirit: serialize the child→parent edge and rebuild the reciprocal through the relationship machinery — never serialize the reciprocal as raw data.
- The engine's glTF instantiation (ADR-0057) already spawns reserved-id entity trees through `Commands` with `withChildren`/`addChild`, firing hooks at flush. That is the proven pattern to mirror for a hook-firing scene spawn.

## Decision

- **The App owns its reflection registry as the `AppTypeRegistry` resource** (a thin engine-owned newtype `{ readonly registry: TypeRegistry }`, the Bevy `AppTypeRegistry` analog), created in the App constructor before any plugin builds. It is per-App, not reflect's process-wide `defaultRegistry`, so independent Apps and tests never share registrations. A bare `TypeRegistry` resource was rejected — it would key the resource map on a foreign class and blur into `defaultRegistry`.
- **Registration is per owning plugin.** `App.registerComponent` / `App.registerType` delegate to the resource (the `app.register_type` analog); each owning plugin registers its own component schemas in `build()`. CorePlugin registers `Transform`, `Name`, `Parent`; VisibilityPlugin registers `Visibility`; MeshPlugin registers `Mesh3d`; each `MaterialPlugin<M>` registers its own `MeshMaterial3d<M>`. No central dump.
- **Derived and reciprocal components are not serialized.** `GlobalTransform`, `InheritedVisibility`, and `ViewVisibility` are recomputed by propagation; `Children` is a reciprocal relationship target rebuilt from `Parent`. None are registered. `static requires` re-attaches them at insert, and the next frame's propagation recomputes them. Only authored state persists.
- **The hierarchy serializes the `Parent` (child→parent) edge only.** `Children` is never written. On the hook-firing load, the decoded `Parent` is not inserted directly; it is routed through `cmd.entity(parent).addChild(child)` so the `appendChild` op wires both sides and fires hooks. This is the #23258 lesson applied; serializing both edges was rejected as a divergence risk.
- **Two load paths share one codec + remap core.** `spawnScene(app, scene, registry?, opts?)` runs the two-phase remap *through* `Commands` with reserved ids (mirroring the glTF reactor) so hooks fire, Required Components resolve, and the hierarchy wires before the flush — the SceneSpawner analog. The bare-`World` `deserializeScene` stays for tools/tests. Both build their `DecodeEnv` from the same helper. The save side gains `serializeScene(app)`; the explicit `serializeWorld(world, registry)` stays.
- **`MeshMaterial3d` registers its runtime subclass.** `MaterialPlugin<M>` synthesizes a per-type subclass `class extends MeshMaterial3d` (so the class-keyed ECS can disambiguate material types under erased generics), and entities carry that subclass. A base-only registration is invisible to the serializer's constructor lookup, and the render queue matches the exact subclass — so each `MaterialPlugin<M>.build()` registers its subclass under the stable name `MeshMaterial3d<MaterialName>`. A reflect-level "resolve subclass to base" scheme was rejected: it would decode to a base ctor the render query never matches, making meshes invisible.
- **Every engine/internal component declares its serialization.** Codified as CLAUDE.md §13: a component defined in a shipped package either has a registered schema or is a deliberately-classified non-serialized (derived/reciprocal/transient) type. The default is persistence.

## Consequences

- A real engine entity graph — parent/child, transforms, names, visibility, meshes, materials — now serializes to JSON and respawns live, with the hierarchy remapped, `Children` rebuilt, Required Components present, derived state recomputed by propagation, and handles resolved by GUID.
- Plugins gain a registration responsibility: an owning plugin that adds an authored component without a schema is now a tracked gap (CLAUDE.md §13). The registry fills in slice by slice as systems are touched — this slice covers the core graph plus one renderable family.
- The hook-firing `spawnScene` and the bare `deserializeScene` diverge intentionally: only the former rebuilds reciprocal relationships and fires hooks. Tools/tests that want a raw structural load keep the bare path; the bare path's `Children` is intentionally absent.
- `MeshMaterial3d` scene type names are generic-qualified (`MeshMaterial3d<UnlitMaterial>`); the registry holds one entry per material type, mirroring the existing `Materials<M>` / `RenderMaterials<M>` per-type resources.
- Accepted costs: `Parent`, `Mesh3d`, and `MeshMaterial3d` need an explicit `make` (their constructors require args) for the bare decode path; required components pulled in by `resolveBundle` do not themselves fire hooks (unchanged from ADR-0060), so "hooks fire" is demonstrated by the relationship wiring, not by the renderable's requires.
- Deferred, not built here: registering every remaining component; the Scene asset type + States-gated load/unload + prefab templates/patches; the persistent GUID asset tier that would remove caller-injected `resolveHandle`.
- No benchmark: `spawnScene` is one-shot load-time setup, not a per-frame or content-cost-scaling path; the per-frame recompute it triggers (transform/visibility propagation) is already benched (CLAUDE.md §11).

## Implementation

- `packages/engine/src/scene/app-type-registry.ts` — `AppTypeRegistry`
- `packages/engine/src/index.ts` — `App.registerComponent`, `App.registerType`, the constructor's `AppTypeRegistry` insert, and the scene re-exports
- `packages/engine/src/scene/spawn.ts` — `spawnScene`, `SpawnSceneOptions`
- `packages/engine/src/scene/serialize.ts` — `serializeScene` (alongside `serializeWorld`)
- `packages/engine/src/scene/deserialize.ts` — `buildDecodeEnv` (shared remap/resolve core)
- `packages/engine/src/core-plugin.ts` — registers `Transform`, `Name`, `Parent`
- `packages/engine/src/visibility/visibility-plugin.ts` — registers `Visibility`
- `packages/engine/src/mesh/mesh-plugin.ts` — registers `Mesh3d`
- `packages/engine/src/material/material-plugin.ts` — registers the per-type `MeshMaterial3d<M>` subclass
- Deliberately not registered (derived/reciprocal): `GlobalTransform`, `InheritedVisibility`, `ViewVisibility`, `Children`
