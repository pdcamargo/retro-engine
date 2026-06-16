---
'@retro-engine/editor-sdk': minor
---

feat(editor-sdk): live-world introspection readers for editor hierarchy + inspector

UI-agnostic readers that turn a running ECS `World` (plus the App's reflection registry) into view-models an editor draws, realizing the editor-sdk roadmap's "engine introspection" phase. Data-reading stays separate from widget-drawing by file; the studio panels map these onto existing widgets.

- `buildOutline(world, opts?)` — flattens the world into depth-tagged `OutlineNode`s by walking the `Parent` edge, so authored scenes, prefab expansions, nested scene instances, and imported model graphs all surface uniformly. Supports `isOpen` / `skip` predicates and an extensible `EntityClassifier` chain (icon/kind per entity; ships engine-known defaults, consumers prepend their own).
- `listComponents(world, registry, entity)` — each attached component tagged serializable (has a reflection schema) or derived, mirroring the engine's authored-vs-derived split; serializable first.

Adds type-level `@retro-engine/ecs` and `@retro-engine/reflect` dependencies (an editor introspection surface legitimately needs the World and reflection types).
