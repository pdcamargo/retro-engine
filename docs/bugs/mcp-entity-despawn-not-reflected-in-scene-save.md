# MCP `entity.despawn` is dropped by a subsequent `scene.save`

- **Reported:** 2026-06-24
- **Severity:** Medium

## Repro

1. With the studio connected to the MCP relay, call `entity.despawn` on one or more authored entities (it returns `{ despawned: true }`, and they disappear from the live viewport).
2. Call `scene.save`.
3. Reload the scene (or restart the studio).

## Expected

The despawned entities are gone from the saved scene and stay gone after reload.

## Actual

The despawned entities come back. `scene.save` even reports the *pre-delete* entity count, and on reload the entities reappear — with **new** entity ids (observed: a delete of ids `29 / 110 / 111` came back as `9 / 107 / 108` after save+reload). So `entity.despawn` mutates the live ECS world but the removal never reaches the scene-authoring/hierarchy model that `scene.save` serializes from; the save writes the stale model and resurrects them.

## Notes

Asymmetry: the MCP spawn/mutation commands clearly do reach the authoring model (saves of MCP-spawned entities persist), but despawn does not. Likely the despawn command path skips whatever sync/notification the hierarchy-panel + authoring layer rely on (the same layer `scene.save` reads). Workaround until fixed: delete from the Hierarchy panel UI (that path updates the authoring model), or edit the `.rescene` directly. Compare the despawn command handler in `packages/editor-mcp/src/commands/` against the spawn/mutation handlers and against how the Hierarchy panel performs a delete.
