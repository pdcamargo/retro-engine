# ADR-0067: Prefab templates & patches

- **Status:** Accepted
- **Date:** 2026-06-08

## Context

Scenes-as-assets (ADR-0062), reflection (ADR-0060/0061), and automatic GUID handle resolution (ADR-0065/0066) make a curated entity graph loadable and round-trippable. `scenes-and-prefabs.md` phases 2–4, and the `prefab-templates-and-patches.md` backlog item, ask for the prefab layer on top: a named, parameterized entity recipe that can be spawned as a fresh entity, applied as a **patch** to an existing one, and embedded in a scene by name + params so the loader expands it.

The shape to borrow is Bevy BSN (PR #20158): *templates produce patches, applied one-shot at spawn*. The mechanics already exist in this engine and must be reused, not re-invented — `spawnScene`'s two-pass, Commands-driven discipline (lifecycle hooks fire, the hierarchy wires from the `Parent` edge) and `resolveBundle`'s transitive `static requires` walk with user-provided-wins. The question the backlog requires we close is **override semantics**: one-shot at spawn vs persistent override.

## Decision

1. **A template is a hybrid: a declarative param schema plus an imperative `build` factory.** `defineTemplate({ name, params, build })` — `params` is a `Record<string, FieldType>` reusing the reflect `t` vocabulary (so params round-trip through the codec and a future editor can introspect them); `build(resolvedParams)` returns the component instances to spawn or patch. Templates are plain data + a closure, held in a per-App `TemplateRegistry` resource keyed by a stable, minification-safe name — no base `Template`/`Prefab` class (composition-only, ADR-0001). A code consumer may pass a `Template` object directly; registration is only what lets a scene (or `spawnTemplate(app, 'Name', …)`) resolve it by name.

2. **Params are typed values that bind through the factory.** A param's `FieldType` carries its static type and optional `.default()`/`.optional()`. A param binds into a component by being read inside `build` (`new Health(p.hp)`); field-level shaping is expressed in code, and the produced unit is a whole component instance. Params encode/decode through the existing codec, so entity- and handle-typed params remap and resolve like any reflected field.

3. **Override semantics are ONE-SHOT, in two layers.** Every override is applied at spawn/expand time and is **not** tracked afterward — there is no template-default-vs-instance provenance, and serialization re-emits the expanded components, never the template ref. The two layers, innermost-first:
   - **(a) Param override** — a `spawnTemplate` call or a scene ref passes `params` that substitute into `build`. Values baked as literals in `build` stay fixed.
   - **(b) Field-level override (scene path only)** — a scene ref carries `overrides`: partial field data per component type, overlaid onto the template-produced instance. Fields *absent* from the override keep the template's value; an override naming a type the template did not produce patches a fresh default-constructed instance and adds it. This is BSN's field-patch idea expressed as declarative partial data (not closures), so it serializes; it decodes against the **current** schema (partials are not version-migrated).

   Cross-ref and explicit conflicts resolve **last-wins** (`resolveBundle` keys user-provided components by constructor), with a scene entity's explicit `components` appended after the template output so they win. The code `spawnTemplate`/`applyTemplate` APIs are param-only — live code already has full control and overrides a whole component by post-inserting it; field-level overrides are a scene-wire-format feature.

4. **Spawn and patch both ride the command buffer and `resolveBundle`.** `spawnTemplate(app, template, params?)` mints a command buffer the way `spawnScene` does, `cmd.spawn(...)`s the produced components, and flushes — so hooks fire and `static requires` fill in, with explicit template components winning over auto-filled deps. `applyTemplate(app, entity, template, params?)` does the same through `cmd.entity(e).insert(...)`: `insertBundle` overwrites a component already present, adds a missing one, and leaves the rest. A produced `Parent` is routed through `addChild` so the reciprocal `Children` wires. No construction path is re-implemented.

5. **It lives in `packages/engine/src/prefab/`.** Templates need reflect (`t`, codec), `Commands`, `resolveBundle` (ecs), and the App registry — all of which already converge in `engine`. A separate package would have to depend on `engine` for `Commands`/`App`. One concern per file (CLAUDE.md §5.5).

**Scene embedding.** `SerializedEntity` gains an optional `templates?: SerializedTemplateRef[]` (`{ template, params?, overrides? }`). `spawnScene` expands the refs before decoding the entity's explicit components. The field is additive and optional, so `SCENE_FORMAT_VERSION` stays `1`, existing scenes are byte-identical, and the importer's strict version check is unaffected. Serialization never emits the field — one-shot means there is no template provenance on a live entity to recover.

## Consequences

- A prefab spawns, patches, and embeds-in-scenes through one expansion path; round-trips are proven by tests (spawn-with-params + required deps, defaults, name lookup, patch overlay, scene-embed with a field-level override).
- One-shot keeps a spawned entity provenance-free: the simplest model, reusing `resolveBundle` + the codec with no diff-on-save. The accepted cost is that a scene authored with a template ref "bakes" into explicit components when that live world is later serialized — the ref is an authoring/source-side concept, not recoverable from a live world. A live prefab link / "revert to prefab" is a separate future ADR with a provenance component, not built here.
- Field-level overrides give Unity-prefab-style per-instance tweaks on the scene path without leaking a second "partial component" concept into runtime code — code keeps whole-component control directly.
- Required Components and hierarchy come for free because spawn and patch ride the same Commands path as `spawnScene`; there is no parallel construction mechanism to keep in sync.
- Inline observer binding (roadmap phase 5) is deferred on a hard dependency: the observer system in `observers-and-events.md` does not exist, so a template cannot bind observers yet. Not stubbed. Scene composition (phase 6), hot-reload (phase 7), and studio integration (phase 8) remain after this slice.
- Bench: `spawnTemplate` / `applyTemplate` × N is content-scaling (level load, wave spawning), so a bench guards the expand + `resolveBundle` + insert path (ADR-0017).

## Implementation

- `packages/engine/src/prefab/template.ts` — `ParamSchema`, `ResolvedParams`, `Template`, `TemplateDefinition`, `defineTemplate`, `expandTemplate`
- `packages/engine/src/prefab/template-params.ts` — `resolveParams`, `decodeParams`, `applyFieldOverrides`
- `packages/engine/src/prefab/template-registry.ts` — `TemplateRegistry`
- `packages/engine/src/prefab/template-commands.ts` — `spawnTemplate`, `applyTemplate`
- `packages/engine/src/prefab/template-scene.ts` — `expandTemplateRefs`
- `packages/engine/src/scene/scene-data.ts` — `SerializedOverride`, `SerializedTemplateRef`, `SerializedEntity.templates`
- `packages/engine/src/scene/spawn.ts` — template-ref expansion in pass 2 of `spawnScene`
- `packages/engine/src/index.ts` — `App.registerTemplate`, the `TemplateRegistry` resource insert, and the prefab + scene-data re-exports
- `packages/engine/src/prefab/spawn-template.test.ts`, `apply-template.test.ts`, `template-scene-roundtrip.test.ts` — spawn / patch / scene-embed coverage
- `packages/engine/bench/template-spawn.bench.ts` — spawn/patch × N content-scaling bench
- `apps/playground/src/prefab-showcase-plugin.ts` — `?mode=prefab` device check
- Builds on ADR-0061 (`spawnScene`, `AppTypeRegistry`), ADR-0060 (the reflect codec), and the M2 Required Components mechanism. Supersedes none.
