---
'@retro-engine/math': minor
---

feat(math): add `rayAabbIntersect` for ray-vs-box queries

Slab-method intersection between a `Ray` and an `Aabb`. Returns the entry distance `t` along the ray (a true Euclidean distance, since `Ray.direction` is unit length) or `null` on a miss; a ray originating inside the box returns `0`, and a box entirely behind the origin returns `null`. Directly comparable across boxes for nearest-hit picking.
