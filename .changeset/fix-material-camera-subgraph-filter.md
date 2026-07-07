---
'@retro-engine/engine': patch
---

fix(engine): skip non-3D cameras in the material queue

`MaterialPlugin.queueMaterials3d` iterated every camera view and pushed
`PhaseItem3d` entries keyed by each camera's entity, with no sub-graph filter. In
a world hosting both a `Camera2d` and a `Camera3d`, the 2D camera accrued 3D phase
items its Core2d sub-graph never drains — wasted work bounded by
`(2D cameras) × (3D renderables)` per frame. The queue now skips views whose
`subGraph !== Core3dLabel`, symmetric to `SpritePlugin.queueSprites` filtering
`Core2dLabel`.
