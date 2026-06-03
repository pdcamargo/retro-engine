# Resource reflection coverage

- **Created:** 2026-06-03 (rescoped from the component sweep, now shipped)

## Context

The **component** half of this gap is closed. ADR-0064 registered every authored component across the camera, 3D-light, 2D-light, sprite, 2D-mesh/material, and post-process families, and classified every derived/transient one as a named not-serialized category — so every component under `packages/*/src/**` now declares its serialization (CLAUDE.md §13). Discriminated-union fields ride on the reflect `t.variant` kind (ADR-0063).

What remains is **resources**. Reflection ([ADR-0060](../adr/ADR-0060-reflection-and-serialization.md)) deferred resources-as-reflectable: there is no mechanism to round-trip resource-shaped state, so the following are blocked, not classified:

- `AmbientLight` (3D), `Shadow3dSettings`
- `ClearColor`
- `Light2dSettings`, `Light2dShadowState`, `Light2dNormalState`
- any other authored resource a saved scene would be expected to restore (e.g. a global gravity / time-scale resource when added)

Render-world and per-frame resources (`SortedCameras`, `TextureAtlasLayouts`, `Materials*` / `RenderMaterials*`, the `View*` caches) are derived/transient and out of scope regardless of the mechanism.

## Why deferred

A resource carries no entity identity and is not part of the entity-graph the scene codec walks, so it needs its own reflection surface — a registry of authored resource types plus a serialize/deserialize path that writes them into the scene envelope (or a sibling document) and restores them on load. That is a distinct mechanism from component reflection, best designed once a consumer (full project save, or an editor "world settings" panel) needs it. Pin the design to [ADR-0060](../adr/ADR-0060-reflection-and-serialization.md)'s deferred note.

## Acceptance

- A mechanism exists to register an authored resource type with a reflection schema and round-trip it through scene save/load.
- Each authored resource above is either registered or explicitly classified non-serialized (derived/transient), so §13 holds for resources the same way it now holds for components.
