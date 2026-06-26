# Animation authoring + retargeting extensions

Follow-up work deferred during the skeletal-animation initiative (Phases 0–5, now
complete). The decisions and detailed rationale live in the sealed ADRs cited
below; this file is the actionable tracker so the deferrals survive the deleted
`docs/roadmap/skeletal-animation.md`. None of these block the shipped feature —
each is a deliberate scope choice, driven by code/MCP today.

## Retargeting (ADR-0122, ADR-0125)

- **Unity-style muscle space** — normalized humanoid muscle representation with
  per-muscle limits. Human-only and heavyweight; the chain-based rig-mapping model
  (ADR-0122) covers the shipped need. Worth it only for a large shared humanoid
  clip library with authored bend limits.
- **Runtime / live-mirror retarget player** — a per-frame component that retargets
  a source rig's *live* pose onto a target every frame, instead of the offline
  `retargetClip` bake (ADR-0122). Needed for mirroring a live actor / networked
  source skeleton, not for playing downloaded clips.
- **Studio retarget UI** — surface `buildHumanoidRetargetRig` / `retargetClip` /
  the authored reference-pose override (ADR-0125) in the editor (rig inspector,
  per-slot bone mapping, a "bake retargeted clip" action). Driven via code/MCP for
  now.

## Animation authoring UI (ADR-0119, ADR-0120)

- **AnimationController node-graph editor** — visual authoring of state machines /
  blend trees (slated for a future shared node-graph package; controllers drive via
  code/MCP today).
- **Avatar-mask authoring UI** — visual per-bone include-set editing for
  `AvatarMask` (driven via code/MCP today).
- **Transition interruption** — mid-crossfade transition handling in the state
  machine (current transitions complete before re-evaluating).
- **Per-layer authored additive reference clip** — override the glTF-bind default
  reference pose additive layers subtract against (ADR-0120).

## Clip format (Phase 1, ADR-0116/0117)

- **Morph-weight channels** — await morph-target meshes (not yet in the engine).
- **Method / event tracks** — fire a callback/event at a keyframe (Godot-style);
  out of scope for the v1 clip format.
