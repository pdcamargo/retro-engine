# ADR-0068: Inline observer binding for scenes

- **Status:** Accepted
- **Date:** 2026-06-08

## Context

`scenes-and-prefabs.md` phase 5 is inline observer binding — the third pillar of the BSN-inspired vision:
a scene describes *behavior*, not just data. A scene should attach observers to its entities without the
consumer round-tripping through code at load time.

ADR-0067 deferred this with a note that the observer system "does not exist." **That premise was
inaccurate.** The observer *runtime* shipped with ADR-0013 and is well-tested: `ObserverRegistry`
(`registerTargeted` / `registerGlobal` / `clearTargetedFor`), the `Trigger(eventCtor)` param,
`commands.entity(e).observe(eventCtor, params, fn)` (enqueues an `attachObserver` op applied at flush),
`commands.trigger` / `commands.entity(e).trigger`, re-entrancy bounded by `MAX_TRIGGER_DEPTH`, and
automatic teardown (the despawn flush arm calls `clearTargetedFor` before the structural mutation). What
was missing was only the **serializable binding layer** that lets a scene name an observer. ADR-0067 is
immutable, so the record is corrected here, not there.

The hard part of serializing an observer is that the *handler is code* — it cannot be stored as data.
Two established models point the same way:

- **Unity UnityEvents** serialize the persistent listener's *method name* (a string) plus its target, and
  resolve it via reflection at load; programmatic `AddListener` calls are not serialized. Behavior is
  referenced by a stable name, not embedded.
- **Bevy BSN** (PR #20158) expresses widget behavior as observers attached in the scene definition —
  callbacks that run on events — rather than as a separate code wiring step.

Both confirm the lean already in `scenes-and-prefabs.md`'s "Observer serialization" open question:
**the handler is registered by name in code; the scene references the name only.**

## Decision

A scene binds **entity-targeted** observers to its entities by referencing **registered handler names**.
Nothing code-shaped is serialized. Five points:

1. **Named-handler registry.** `defineObserverHandler({ name, event, params, run })` produces an
   `ObserverHandler` that bundles everything the runtime needs to attach it: the **event constructor**, its
   **`Param[]`**, and the observer **`run` fn**. Handlers live in a per-App `ObserverHandlerRegistry`
   resource (inserted at construction), keyed by a stable, minification-safe `name`; a plugin registers
   them from `build()` via `app.registerObserverHandler(...)`. Duplicate name **throws** — the name is the
   identity a scene references. Composition-only: data + a closure, no base `Handler`/`Observer` class — a
   direct mirror of `TemplateRegistry` / `defineTemplate`.

2. **Event resolution lives in the handler, not the scene.** The handler registration carries its `event`
   ctor; the scene references the handler name alone. No separate event registry — the event is an
   implementation detail of the handler, and the runtime already keys observers on event-ctor identity at
   attach. This keeps the scene-facing surface to a single string.

3. **Binding wire format.** `SerializedEntity` gains an optional
   `observers?: readonly SerializedObserverBinding[]`, where `SerializedObserverBinding = { handler: string }`.
   The object shape (not a bare `string[]`) mirrors `SerializedTemplateRef` beside it and leaves room for
   future per-instance binding data as an additive field — without a wire migration. v1 is name-only: an
   observer's params resolve from world/event context (`Trigger`, `Commands`, queries), not from
   inspector-frozen literals, so there is no "static argument" to carry yet. The field is additive and
   optional, so `SCENE_FORMAT_VERSION` stays `1`, existing scenes are byte-identical, and the importer's
   strict version check is unaffected. Serialization never emits the field — a bound observer leaves no
   recoverable provenance on a live entity, the same one-shot/source-side stance ADR-0067 took for
   template refs.

4. **Scenes bind entity-targeted observers only.** `spawnScene` attaches each binding through
   `commands.entity(e).observe(handler.event, handler.params, handler.run)` — the same tested path a
   code-side `.observe` takes — so lifecycle hooks fire and registration lands deterministically at flush.
   Global / app-level observers are app code (`App.addObserver` in a plugin's `build()`), not scene data,
   and stay out of scope: a scene is about its entities.

5. **Teardown reuses the existing path.** No new machinery. The despawn flush arm already calls
   `observerRegistry.clearTargetedFor(entity)` before the structural despawn, so tearing down a scene
   (which despawns its entities) drops every bound observer automatically.

Resolution **throws** on an unregistered handler name (matching `expandTemplateRefs` for templates):
behavior referenced by name is code, and a missing name is an authoring error that would otherwise produce
a silently dead binding, not a droppable component.

## Consequences

- A scene can carry behavior, not just data: `{ handler: 'onClick' }` on an entity attaches a working
  observer at load, through the one tested runtime path. Round-trips are proven by tests (attach-and-fire,
  JSON round-trip, throw-on-unregistered, despawn-teardown).
- The accepted cost mirrors templates: a binding is an authoring/source-side concept. Serializing a live
  world re-emits its components but **not** its observer bindings — there is no binding provenance on a live
  entity to recover. A "save the scene's bindings back" story would need a provenance side-channel; not
  built here.
- The scene-facing surface is a single string per binding, so a future editor can offer a dropdown of
  registered handler names with no new wire concepts.
- **Forward-compat / not in scope:**
  - **Event propagation / bubbling** (`propagate()` up the `Parent` hierarchy) is orthogonal to binding and
    flagged as future work in the observer runtime; not built here.
  - **Per-instance binding data** (e.g. static arguments frozen into a binding) is a future additive field
    on `SerializedObserverBinding` — the object shape reserves room for it without a wire migration.
  - **Templates carrying their own bindings** is a possible convenience but is not part of this core
    decision.
  - Scene composition (phase 6), binding hot-reload (phase 7), and the studio binding UI (phase 8) remain
    after this slice.
- Bench: binding attachment is one-shot at scene load, but it is content-scaling (N entities × bindings), so
  a bench guards the resolve-by-name + `observe`-op path at load (ADR-0017).

## Implementation

- `packages/engine/src/observer-binding/handler.ts` — `ObserverHandler`, `ObserverHandlerDefinition`,
  `defineObserverHandler`
- `packages/engine/src/observer-binding/handler-registry.ts` — `ObserverHandlerRegistry`
- `packages/engine/src/observer-binding/scene-binding.ts` — `resolveObserverBindings` (throws on an
  unregistered handler name)
- `packages/engine/src/scene/scene-data.ts` — `SerializedObserverBinding`, `SerializedEntity.observers`
- `packages/engine/src/scene/spawn.ts` — observer-binding resolve + attach in pass 2 of `spawnScene`
- `packages/engine/src/index.ts` — `App.registerObserverHandler`, the `ObserverHandlerRegistry` resource
  insert, and the observer-binding + scene-data re-exports
- `packages/engine/src/observer-binding/handler-registry.test.ts`,
  `observer-binding-scene.test.ts` — registry + attach / round-trip / throw / despawn-teardown coverage
- `packages/engine/bench/observer-binding.bench.ts` — content-scaling resolve + attach at scene load
- `apps/playground/src/observer-showcase-plugin.ts` — `?mode=observers` device check
- Builds on ADR-0013 (the observer runtime: `ObserverRegistry`, `Trigger`, `commands.observe`),
  ADR-0061 (`spawnScene`, `AppTypeRegistry`), and ADR-0067 (`SerializedEntity.templates`, the
  registry-by-stable-name precedent). Supersedes none.
