---
'@retro-engine/engine': minor
---

feat(reflect): register engine components + hook-firing `spawnScene` (ADR-0061)

Makes reflection (ADR-0060) work on the engine's own content: real components register into a registry the App owns, and a new command-driven load brings a scene back live instead of inert. Closes the two follow-ups ADR-0060 reserved.

**New public surface:**

- `AppTypeRegistry` — the App's reflection registry resource (Bevy `AppTypeRegistry` analog), created in the App constructor. Per-App, not reflect's process-wide `defaultRegistry`.
- `App.registerComponent(ctor, schema, opts?)` / `App.registerType(ctor, schema, opts?)` — register a type's schema in the App's registry. The `app.register_type` analog; owning plugins call it from `build()`.
- `spawnScene(app, scene, registry?, opts?)` (+ `SpawnSceneOptions`) — load a `SceneData` through `Commands` with reserved ids, so component hooks fire, Required Components resolve, and the hierarchy wires (the `Parent` edge routed through `addChild`, rebuilding `Children`) before the flush. Complements the bare-`World` `deserializeScene`, which stays for tools/tests.
- `serializeScene(app, opts?)` — serialize an App's world using the App's own registry. Pairs with `spawnScene`.

**Behaviour:**

- Core graph + one renderable family now register their schemas from their owning plugins: `Transform`, `Name`, `Parent` (CorePlugin), `Visibility` (VisibilityPlugin), `Mesh3d` (MeshPlugin), and per-type `MeshMaterial3d<M>` under the qualified name `MeshMaterial3d<MaterialName>` (MaterialPlugin). Derived/reciprocal components (`GlobalTransform`, the inherited/view visibility booleans, `Children`) are deliberately not registered — recomputed/rebuilt on load.
- `serializeScene → JSON → spawnScene` round-trips a real parent/child engine graph: hierarchy remapped, `Children` rebuilt from the `Parent` edge, Required Components present, `GlobalTransform` recomputed by propagation, handles resolved by GUID onto the App's per-type material subclass.
