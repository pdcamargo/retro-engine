# `MaterialPlugin.queueMaterials3d` lacks a camera sub-graph filter

`MaterialPlugin<M>`'s queue system (`packages/engine/src/material/material-plugin.ts:400`) iterates *every* entry in `SortedCameras.views` and pushes a `PhaseItem3d` into `ViewPhases3d` keyed by every camera's `sourceEntity`. There is no filter on `camera.subGraph`.

When the same world hosts a `Camera2d` and a `Camera3d`, the 2D camera's entity id receives `PhaseItem3d` entries that are never drained (the Core2d sub-graph runs `OpaquePass2dNode` / `TransparentPass2dNode`, which read `ViewPhases2d`, not `ViewPhases3d`). The wasted CPU work is bounded by `(2D cameras) × (3D renderables)` per frame — not visible at sub-thousand renderable counts, but real.

`SpritePlugin.queueSprites` (added in Phase 8.1) avoids the same trap by filtering `view.subGraph !== Core2dLabel` before iterating batches. The fix on the 3D side is the symmetric one: filter `view.subGraph !== Core3dLabel` in `queueMaterials3d`. Cost is one map lookup per camera per frame.

Not urgent — the wasted entries are inert. File closed when the 3D queue grows the filter (one new line; the camera label is already on `view.subGraph`).
