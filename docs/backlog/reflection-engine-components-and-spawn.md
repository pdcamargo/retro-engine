# Reflection on engine components + hook-firing spawn

- **Created:** 2026-06-02

## Context

The slice that makes reflection (ADR-0060) real on the engine's own content: it registers real engine components into a registry the App owns, and adds a command-driven scene spawn so a loaded scene is live, not inert. Closes the two follow-ups ADR-0060 reserved — engine-component registration and an App/Commands hook-firing deserialize. Sealed by **ADR-0061**.

What landed:

- **`AppTypeRegistry` resource** (the Bevy `AppTypeRegistry` analog), created in the App constructor; `App.registerComponent` / `App.registerType` delegate to it. Per-App, not reflect's `defaultRegistry`.
- **Per-plugin registration** of the core graph + one renderable family: CorePlugin (`Transform`, `Name`, `Parent`), VisibilityPlugin (`Visibility`), MeshPlugin (`Mesh3d`), MaterialPlugin (per-type `MeshMaterial3d<M>` subclass under the qualified name `MeshMaterial3d<MaterialName>`). Derived/reciprocal components (`GlobalTransform`, `InheritedVisibility`, `ViewVisibility`, `Children`) are deliberately not registered.
- **`spawnScene(app, scene, registry?, opts?)`** — two-phase remap through `Commands` with reserved ids, so hooks fire, Required Components resolve, and the hierarchy wires (the `Parent` edge routed through `addChild`, rebuilding `Children`) before the flush. Complements the bare-`World` `deserializeScene`, which stays for tools/tests; both share `buildDecodeEnv`. Save side gains `serializeScene(app)`.
- **CLAUDE.md §13** — every engine/internal component declares its serialization (schema or deliberate non-serialized classification).

## Why deferred

Not deferred — implemented in this slice. This file is the **done gate**: it tracks the slice until the work is confirmed complete and is then deleted (per `docs/backlog/README.md`, only on explicit confirmation).

Deliberately out of this slice, to be promoted as their own items: registering every remaining component (filled in as systems are touched, per CLAUDE.md §13); the Scene asset type + States-gated load/unload (`OnEnter`/`OnExit`) + prefab templates/patches (the next slice); and the persistent GUID asset tier (asset phases 4–6) that would remove caller-injected `resolveHandle`.

## Acceptance

- A real engine graph — a parent (`Transform` + `Name`) with a child (`Transform` + `Mesh3d` + `MeshMaterial3d` + `Visibility`) — round-trips `serializeScene → JSON → spawnScene` into a fresh App and, after one frame, has: the `Parent` edge remapped to the freshly-spawned parent; `Children` rebuilt on the parent (not serialized); Required Components (`GlobalTransform`, the visibility stack) present; `GlobalTransform` recomputed by propagation (parent ∘ child-local, not read from data); and mesh/material handles resolved by GUID, the material decoded onto the App's per-type `MeshMaterial3d` subclass.
- The bare-`World` `deserializeScene` still round-trips and, given a `Parent`-only scene, leaves `Children` unbuilt — the documented contrast with `spawnScene`.
- Lint, typecheck, test, build, and bench are green.
