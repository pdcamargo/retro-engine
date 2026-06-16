# Studio play mode: snapshot on play, restore on stop

- **Created:** 2026-06-16

## Context

The studio has a play/stop toolbar (`state.playing`) but no behavior behind it.
The intended semantics: entering play simulates the live world; stopping reverts
the scene to exactly its pre-play state, so edits made while playing are
discarded. The serialization system already provides the primitives — Play
snapshots the world with `serializeScene(app)`; Stop clears the authored entities
and re-spawns from the snapshot with `spawnScene`.

## Why deferred

It is a self-contained feature orthogonal to the live-world bridge (ADR-0079) and
the scene-loading seam (ADR-0080) that just landed; sequencing it after them keeps
each slice focused. It also surfaces a real design question (below) worth deciding
deliberately rather than in passing.

## Acceptance

- Pressing Play snapshots the world; pressing Stop restores it so no in-play edit
  survives, and the hierarchy/inspector reflect the restored state.
- **Selection survives the round-trip.** ADR-0079 keys `state.selectedEntity` (and
  `collapsed`) by raw `Entity`, but `spawnScene` mints fresh ids on restore, so a
  stable editor identity is needed — e.g. remap selection through the
  scene-local id map, or key it on a persistent `Name`/editor id. The chosen
  approach is documented (an ADR if non-trivial).
- Editor-infra entities (cameras, grid) and runtime-only state are excluded from
  the snapshot/restore so only authored content reverts.
