---
'@retro-engine/engine': minor
---

feat(engine): nested (recursive) blend trees in the animation controller

Per ADR-0140 (supersedes ADR-0119's flat blend-tree child shape), a blend tree's
children now hold a full nested `Motion` instead of a bare clip handle, so blend
trees nest arbitrarily deep and each nested level can be driven by a different
parameter than its parent — e.g. an 8-way directional 2D tree (`moveX`/`moveY`)
whose every slot is a 1D idle → walk → run blend on a separate `speed` parameter.

This is a clean break with no backwards compatibility: the flat child shape is
replaced outright and the `.ranimctrl` wire format bumps to version 2, so old
serialized controllers may fail to load.

**Changed public surface:**

- `Motion` — `blend1d`/`blend2d` children are now `{ motion, threshold }` /
  `{ motion, x, y }` (was `{ clip, threshold }` / `{ clip, x, y }`); a leaf is
  `{ kind: 'clip', clip }`.
- `evaluateMotion` — recurses through nested motions; a leaf clip's weight is the
  product of every blend weight along its path times the crossfade weight. Its
  signature now takes a `MotionScratch` and a `depth` (replacing the flat weight
  scratch), and phase still propagates down unchanged so clips stay
  phase-synchronized across the whole structure.
- `MotionScratch` — new pooled per-depth weight/position scratch keeping the
  recursive per-frame evaluation allocation-free.
- `motionDuration` — recurses to the longest leaf-clip duration anywhere in the
  tree.
- `weights1d` — widened to accept a `Float32Array` scratch (was `readonly number[]`).
- `ANIMATION_CONTROLLER_FORMAT_VERSION` — bumped to `2`; the `.ranimctrl`
  serializer/importer round-trips the full recursive structure, emitting/resolving
  clip GUIDs only at the leaves.
