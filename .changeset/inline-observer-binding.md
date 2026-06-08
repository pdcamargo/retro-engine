---
'@retro-engine/engine': minor
---

feat(engine): inline observer binding for scenes — bind named handlers in scene data

Per ADR-0068, `scenes-and-prefabs.md` phase 5. A scene can now attach **entity-targeted observers** to its entities by referencing **registered handler names** — the third BSN-inspired pillar, where a scene describes behavior, not just data. The observer *runtime* already existed (ADR-0013); this is the serializable binding layer on top of it. Modeled on Unity's UnityEvents (serialize the handler name, resolve at load); the handler itself is code and is never serialized.

**New public surface:**
- `defineObserverHandler({ name, event, params, run })` / `ObserverHandler`, `ObserverHandlerDefinition` — bundle the event a handler observes, its `Param[]`, and the body, under a stable, minification-safe name.
- `App.registerObserverHandler(handler)` / `ObserverHandlerRegistry` — register a handler by name (from a plugin's `build()`) so a scene can attach it; duplicate name throws.
- `SerializedObserverBinding` (`{ handler: string }`) and an optional `observers?` field on `SerializedEntity` — a scene names the handlers to attach to an entity; `spawnScene` resolves and attaches each through the same `commands.entity(e).observe` path, so lifecycle hooks fire and teardown is automatic.

**Semantics:** scenes bind entity-targeted observers only (global/app-level observers stay app code). A binding names a handler and nothing else — the handler carries the event, so no separate event registry is needed. Resolution throws on an unregistered handler name. Teardown reuses the existing despawn path (`clearTargetedFor`), so tearing down a scene drops its bound observers automatically. Serialization never emits bindings — like template refs, a binding is authoring/source-side, not recovered from a live world.

`SCENE_FORMAT_VERSION` stays `1` — the `observers` field is additive and optional, so existing scenes are byte-identical.
