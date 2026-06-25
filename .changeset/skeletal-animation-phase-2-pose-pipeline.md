---
'@retro-engine/engine': minor
---

feat(engine): skeletal-animation Phase 2 — pose pipeline + animation controller

Per ADR-0118 and ADR-0119, animation no longer samples straight into `Transform`. A clip now
samples into a **`Pose`** (per-bone local TRS), poses **blend**, and the blended result is
committed to bone `Transform`s **exactly once** per frame — the architectural hinge the rest of
the Unity-like stack (layers/masks, IK, retargeting) builds on. Phase 1's general property
animation is unchanged: only whole-field bone `Transform` tracks route through the pose; every
other track still writes directly.

**Pose pipeline** (`pose.ts`, `pose-blend.ts`):

- `Pose` — per-bone TRS as SoA `Float32Array`s, addressed by slot, held in the transient
  `AnimationPoses` resource (not a component, not serialized). Doubles as the blend accumulator
  with per-field per-slot weights, so a clip that drives only some bones (or only a rotation)
  leaves the rest at their authored values.
- Sign-aligned accumulated nlerp for rotations (`accumulateRotation`/`finalizePose`), weighted
  average for translation/scale; `samplePoseFromClip` and `commitPoseToTransforms`.
- The evaluation system (`animation-system.ts`) routes both `AnimationPlayer` and the new
  controller through the pose, commits once in the `update` stage (before `postUpdate`
  propagation → skinning), and keeps the non-bone direct-write path.

**Animation controller** (`animation-controller.ts`, `state-machine.ts`, `blend-tree.ts`) — a
Unity-Animator-Controller-shaped asset (`.ranimctrl`) unifying Bevy's blend graph with a state
machine:

- `AnimationController` asset: parameters (`float`/`bool`/`trigger`), states (clip or blend-tree
  motion), and condition/trigger transitions with crossfade `duration` + optional exit time.
- Blend trees: 1D linear plus all three Unity 2D modes (`simpleDirectional`, `freeformCartesian`,
  `freeformDirectional`).
- `AnimationControllerPlayer` component (authored `controller`/`speed`/`playing`/`parameters`,
  schema-registered) + transient `AnimationControllerRuntimes` resource (active state, crossfade
  progress, per-state phase). The transition weight-ramp is the crossfade.

Adds a `pose-blend` bench (cost grows with bones × sources).
