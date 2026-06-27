---
'@retro-engine/engine': minor
'@retro-engine/gltf': minor
---

feat(engine): animate morph-target weights from glTF morph channels

glTF `weights` animation channels now drive a `MorphWeights` component, and the
animation system can sample a number-array leaf.

- `@retro-engine/gltf`: `mapAnimations` maps a `weights` channel to a track on the
  node's `MorphWeights` (`path: weights`), deriving the per-keyframe component
  count (target count) from the input/output accessor lengths (`× 3` for
  `CUBICSPLINE`). Previously these channels were dropped.
- `@retro-engine/engine`: `applyTrack` handles an `array` leaf kind — it samples
  `componentCount` values into the array element-wise (morph-target weights),
  reusing the existing keyframe sampler. A bound `AnimationPlayer` now animates a
  mesh's blend-shape weights over time.

(Studio inspector also renders one `[0,1]` slider per morph target name — apps-only,
no package change.)
