---
'@retro-engine/engine': minor
---

feat(engine): prefab templates & patches — spawn, patch, and embed-in-scene

Per ADR-0067, the prefab layer on top of scenes (`scenes-and-prefabs.md` phases 2–4). A **template** is a named, parameterized entity recipe — a declarative param schema (reusing the reflect `t` vocabulary, so params round-trip) plus an imperative `build` factory that produces component instances. Adapts Bevy BSN's *templates-produce-patches, one-shot-at-spawn* model to our archetype World, reflection registry, and `resolveBundle` Required-Components mechanism. Templates are data + a closure over a per-App registry — no base class.

**New public surface:**
- `defineTemplate({ name, params, build })` / `Template`, `TemplateDefinition`, `ParamSchema`, `ResolvedParams`, `expandTemplate` — define a template; params are typed `FieldType`s with `.default()`/`.optional()`.
- `spawnTemplate(app, template | name, params?)` — spawn a fresh entity, substituting params and resolving Required Components through the command buffer (hooks fire, `static requires` fill in).
- `applyTemplate(app, entity, template | name, params?)` — apply a template as a patch to an existing entity: overwrite a present component, add a missing one, leave the rest.
- `App.registerTemplate(template)` / `TemplateRegistry` — register by stable name so a scene (or `spawnTemplate(app, 'Name', …)`) resolves it.
- `SerializedTemplateRef`, `SerializedOverride` and an optional `templates?` field on `SerializedEntity` — a scene embeds a template by name + params; `spawnScene` expands it, with per-instance field-level `overrides`.

**Override semantics (locked):** one-shot, in two layers — typed `params` substitute into `build`, and a scene ref may additionally overlay field-level `overrides` onto the produced components (absent fields keep the template value). Nothing is tracked after spawn; serialization re-emits the expanded components, not the ref.

`SCENE_FORMAT_VERSION` stays `1` — the `templates` field is additive and optional, so existing scenes are byte-identical. Inline observer binding (roadmap phase 5) is deferred on the not-yet-built observer system.
