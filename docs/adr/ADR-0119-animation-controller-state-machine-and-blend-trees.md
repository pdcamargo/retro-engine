# ADR-0119: Animation controller — state machine, blend trees, and transitions

- **Status:** Accepted
- **Date:** 2026-06-25

## Context

ADR-0118 establishes the pose pipeline: clips sample into a pose, poses blend, and
the result is committed to bone `Transform`s once. On top of that, Phase 2 needs
the authored, Unity-like surface the roadmap calls for: a weighted blend of N
clips, crossfades/transitions over a duration, 1D and 2D blend trees, and the
state-machine/graph that drives them (Bevy's `AnimationGraph` + `AnimationPlayer`
is the shape reference).

Bevy models this as a pure blend DAG (clip/blend/add nodes with weights) plus a
separate `AnimationTransitions` component for crossfades; Unity's Animator
Controller unifies a state machine (named states, parameters, condition/trigger
transitions, exit time) with blend trees as the motion inside a state. The state
machine and the blend graph share all of their runtime plumbing — parameters, the
transition weight-ramp, and the node → weight → pose → commit chain. Splitting
them across phases would force a later schema migration on the player and asset
(CLAUDE.md §13 / hot reload), so they are decided together here.

## Decision

**One Unity-Animator-Controller-shaped asset, not a separate blend DAG.** A new
`AnimationController` asset (kind `AnimationController`, extension `.ranimctrl`)
holds: declared **parameters** (`float` / `bool` / `trigger`, with defaults);
**states**, each playing a **motion** that is either a single clip or a blend tree;
**transitions** (per-state plus an "any state" source, `from = -1`) with
condition predicates, a crossfade `duration`, and optional `hasExitTime`/`exitTime`;
and a default state. Blend trees are motions inside a state — there is no
free-standing blend DAG. The asset is entity-agnostic and shareable like an
`AnimationClip`; an `AnimationControllerPlayer` binds it to a rig, reusing the
existing `AnimationTarget` for bone resolution (unchanged).

**All parameters are numeric at runtime** (booleans/triggers use `0`/`1`), so one
parameter space drives both blend trees and conditions. A `trigger` is a value the
state machine resets to `0` when a transition it gates fires (consume-on-fire).

**Blend-tree weighting — 1D plus all three Unity 2D modes.** 1D is linear
interpolation between the two thresholds bracketing the parameter. 2D supports
`simpleDirectional` (angular-sector barycentric over the two adjacent directions
and an optional center), `freeformCartesian` (Cartesian gradient-band, position
only), and `freeformDirectional` (polar gradient-band in (magnitude, angle) space,
origin handled by magnitude). The mode is a field on the blend-2d motion.

**Crossfade is the transition weight-ramp.** A fired transition ramps the
destination state's weight `0 → 1` and the source's `1 → 0` over `duration`
seconds; conditions only decide *when* it fires. During a crossfade both states'
motions are evaluated and their weighted clip contributions blend through the
ADR-0118 pose pipeline. The model is single-transition (no mid-transition
interruption) for this phase.

**Reflection split (CLAUDE.md §13).** `AnimationControllerPlayer` is authored:
`controller` (handle), `speed`, `playing`, and `parameters` (a list of
`{ name, value }`, runtime-mutable by gameplay/MCP, overriding the controller's
declared defaults) all have a schema. The state-machine runtime — active state,
crossfade progress, per-state phase — is transient and lives in the
`AnimationControllerRuntimes` resource, not on the component or in a scene.
`AnimationController` is an asset (its `.ranimctrl` serializer encodes clip
references by GUID and resolves them back through the `AnimationClips` store), not
a component schema. Phase 1's `AnimationPlayer` is untouched and continues to work
through the same pose pipeline.

## Consequences

- Building one structure (controller) instead of two (a Bevy blend DAG now, a Unity
  state machine later) avoids overlapping mechanisms and the schema migration a
  deferral would have caused; it also matches the mental model a Unity/Godot user
  brings.
- The single-transition model is deliberate: interruption (a transition firing
  mid-crossfade), additive layers, and avatar masks are Phase 3. Per-state speed is
  supported; sync-by-normalized-phase keeps different-length blend-tree clips
  aligned.
- A controller's `.ranimctrl` round-trips independently of runtime clip slots
  because it stores clip GUIDs; an unresolved GUID reserves a slot a later-loaded
  clip fills.
- The node-graph *editor UI* for authoring controllers is intentionally **not**
  part of this phase — it is deferred to a future shared node-graph package
  (controllers drive via code/MCP for now).

## Implementation

- `packages/engine/src/animation/animation-controller.ts` — `AnimationController`,
  `Motion`, `ControllerParameter`/`ControllerState`/`Transition`/`TransitionCondition`,
  `evaluateMotion`, `motionDuration`.
- `packages/engine/src/animation/blend-tree.ts` — `weights1d`, `weights2d`, `Blend2dMode`.
- `packages/engine/src/animation/state-machine.ts` — `stepController`,
  `stateWeights`, `createControllerRuntime`, `AnimationControllerRuntimes`,
  `ControllerRuntime`, `ParameterAccess`.
- `packages/engine/src/animation/animation-controller-asset.ts` —
  `AnimationControllers`, `ANIMATION_CONTROLLER_ASSET_KIND`, importer/serializer.
- `packages/engine/src/animation/animation-controller-player.ts` —
  `AnimationControllerPlayer`.
- `packages/engine/src/animation/animation-plugin.ts` — registers the asset kind/
  store/serializer/loader, the `AnimationControllerPlayer` schema, and the
  `AnimationControllerRuntimes` resource.
