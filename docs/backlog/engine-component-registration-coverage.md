# Resource reflection coverage

- **Created:** 2026-06-03 (rescoped from the component sweep, now shipped)
- **Status:** Shipped (ADR-0069) — awaiting user confirmation before deletion (CLAUDE.md §3)

## Context

The **component** half of this gap was closed first. ADR-0064 registered every authored component across the camera, 3D-light, 2D-light, sprite, 2D-mesh/material, and post-process families, and classified every derived/transient one as a named not-serialized category — so every component under `packages/*/src/**` declares its serialization (CLAUDE.md §13). Discriminated-union fields ride on the reflect `t.variant` kind (ADR-0063).

The **resource** half is now closed too. [ADR-0069](../adr/ADR-0069-resource-reflection.md) added `App.registerResource` + the additive `SceneData.resources`, so a resource round-trips through scene save/load reusing the component codec. The named resources are classified:

- **Registered (serialized):** `AmbientLight`, `Shadow3dSettings` (Light3dPlugin); `ClearColor` (CameraPlugin); `Light2dSettings` (Light2dPlugin).
- **Not serialized (derived/transient):** `Light2dShadowState`, `Light2dNormalState` — these were mislabeled here as authored; they hold GPU handles, scratch buffers, and per-frame counters, so they are transient (corrected in ADR-0069's context). Also `GpuLights`, `Shadow3dState`, `SortedCameras`, `TextureAtlasLayouts`, `Materials*` / `RenderMaterials*`, the `View*` caches, and the render-graph phase/pipeline/buffer resources.
- **Not serialized (startup/app config):** `MeshAllocatorSettings` (`minSlabSize`) — authored, but read once when `MeshPlugin` builds the `MeshAllocator`; it is engine/app tuning, not per-scene content, and changing it after the allocator exists has no effect, so a scene does not carry it.

A global gravity / time-scale resource, when added, registers the same way.

## Resolution

A resource carries no entity identity, so ADR-0069 gave it its own surface: `App.registerResource` records membership in `AppTypeRegistry.resources` while the schema lives in the App's one `TypeRegistry`, and resources serialize into `SceneData.resources` against the same env the entities use. `serializeScene` captures them; `spawnScene` restores them via `insertResource`.

## Acceptance

- ✅ A mechanism exists to register an authored resource type with a reflection schema and round-trip it through scene save/load (`App.registerResource`, `SceneData.resources`).
- ✅ Each authored resource above is either registered or explicitly classified non-serialized, so §13 holds for resources the same way it does for components.

Delete this file once the user confirms the resource-classification work is done.
