# ADR-0140: Nested (recursive) blend trees

- **Status:** Accepted
- **Date:** 2026-07-01
- **Supersedes:** ADR-0119 (the blend-tree child shape; the rest of ADR-0119 —
  the controller/state-machine/transition model — stands)

## Context

ADR-0119 decided the `AnimationController` and modelled a blend tree's children
as bare clip references: a `blend1d` child was `{ clip, threshold }` and a
`blend2d` child `{ clip, x, y }`. That is one level of blending — a state's motion
resolves directly to weighted clips.

Real locomotion authoring wants more: a directional 2D tree (driven by
`moveX`/`moveY`) where each of the 8 directional slots is itself a 1D idle → walk
→ run blend driven by a separate `speed` parameter — 8-way movement that *also*
blends by speed, per direction. The flat child shape can't express this; a slot
can only be a single clip, not another tree keyed off a different parameter.

## Decision

**A blend-tree child holds a full nested `Motion`, not a clip handle.** `Motion`
becomes recursive: a `blend1d` child is `{ motion, threshold }` and a `blend2d`
child is `{ motion, x, y }`, where `motion` is any `Motion` — a leaf
`{ kind: 'clip', clip }` or another blend tree. Trees nest arbitrarily deep, and
each nested level names its own driving parameter(s), independent of its parent.

**Clean break — no backwards compatibility.** The flat child shape is replaced
outright; the `.ranimctrl` wire format bumps to version 2 with no migration path,
and old serialized controllers may fail to load. This is accepted (pre-0.1.0,
tracked by CLAUDE.md §6).

**Evaluation recurses.** `evaluateMotion` resolves a blend node's per-child
weights from the driving parameter(s) (`weights1d`/`weights2d`) and, for each
child with positive weight `w`, recurses into that child's motion with incoming
weight `incoming × w`. A leaf clip's final weight is the product of every blend
weight along its path times the cross-state crossfade weight — the exact
composition the flat code already did one level deep. `phase` propagates down
unchanged, so every leaf clip is sampled at `phase × duration` and different-length
clips stay phase-synchronized across the whole structure. `motionDuration`
recurses to the longest leaf duration anywhere in the tree.

**Allocation-free hot path via a per-depth scratch pool.** A `MotionScratch`
holds one weight buffer and one threshold/position buffer per nesting depth, grown
on demand and reused across frames. This replaces the single flat weight scratch
(which assumed one level) and folds in the former per-call `positions`
`Float32Array` allocation, so nesting does not multiply per-frame allocations.

## Consequences

- The motivating 8-way × speed case (and any deeper composition) is now
  expressible with the same runtime plumbing; the pose/blend pipeline, layers,
  masks, IK, and retargeting are unaffected — they consume `MotionInput[]`
  regardless of how the weights were derived.
- Old `.ranimctrl` files break. Acceptable during scaffold; the format version
  guard rejects them with a clear error rather than mis-parsing.
- `evaluateMotion`'s signature changed (a `MotionScratch` and a `depth` parameter
  replace the flat `weightScratch`); it is internal to the animation package and
  its callers/tests were updated in lockstep.
- The graph-editor UI for authoring nested trees, sub-state-machines, and any
  pose-pipeline changes remain out of scope here.

## Implementation

- `packages/engine/src/animation/animation-controller.ts` — `Motion` (recursive),
  `MotionScratch`, `evaluateMotion`, `motionDuration`, `MotionInput`.
- `packages/engine/src/animation/blend-tree.ts` — `weights1d` (widened to accept a
  `Float32Array` scratch), `weights2d`, `Blend2dMode`.
- `packages/engine/src/animation/animation-controller-asset.ts` — recursive
  `SerializedMotion`, `encodeMotion`/`decodeMotion`, the `.ranimctrl`
  serializer/importer, `ANIMATION_CONTROLLER_FORMAT_VERSION` (bumped to 2).
- `packages/engine/src/animation/animation-system.ts` — `collectMotionClips`
  (recursive leaf-clip collection), `evaluateLayerInputs`, and the controller/
  layer evaluation paths (shared `MotionScratch`).
