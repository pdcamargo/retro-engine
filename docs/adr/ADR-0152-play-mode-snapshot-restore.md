# ADR-0152: Play-mode snapshot / restore and system gating

- **Status:** Accepted
- **Date:** 2026-07-06

## Context

The studio can enter `Edit` / `Play` / `Paused` via `SimState` (ADR-0087), and
gates the user project's systems behind `inState(SimState.Play)`. But pressing
Play then Stop today leaves the world however the simulation left it — edits made
while playing persist, which is wrong: Play must be a sandbox that reverts on
Stop, exactly like Unity's play mode.

The serialization system already has the primitives (ADR-0060/0061): `serializeWorld`
captures a world (with an entity `filter`, the same hook hot-reload uses to keep
the user scene and drop editor infra, ADR-0102), and `spawnScene` / `deserializeScene`
respawn it. What's missing is a small mechanism that snapshots on entering Play
and restores on returning to Edit, wired to the `SimState` transitions, plus a
clearly-decided gating policy.

Forces:

- **Revert must exclude editor infrastructure.** The editor camera, grid, and
  transient previews are tagged `EditorOnly`; they must not be snapshotted or
  despawned. A caller-supplied `keep` predicate decides what is "authored."
- **The mechanism must be reusable and testable without the studio.** It belongs
  in `@retro-engine/editor-sdk` (home of `SimState`), operable on a bare `World`
  so its round-trip is unit-tested with no renderer.
- **Fresh ids on restore.** `spawnScene` mints new entity ids, so anything keyed
  on the raw `Entity` (the editor's selection) needs remapping — surface the
  scene-id → new-entity map so the studio can remap.

## Decision

Add play-mode snapshot/restore to `@retro-engine/editor-sdk`:

- **Gating policy (formalized).** User project systems run only under
  `inState(SimState.Play)`; engine + editor systems always run. `Paused` is
  simply "not `Play`", so gameplay freezes while the editor and rendering stay
  live. This is the policy the studio already applies; this ADR fixes it.
- **Snapshot scope (v1): authored entities, not resources.** Capture serializes
  the entities passing `keep` (authored content), excluding `EditorOnly` infra.
  Registered resources are *not* reverted in v1 — reverting them risks clobbering
  editor/runtime resources, and the backlog's intent ("revert the scene") is
  entity-centric. Resource revert is a tracked follow-up, not a silent omission.
- **Transition wiring.** `onExit(SimState.Edit)` captures a snapshot into a
  resource; `onEnter(SimState.Edit)` restores it if one exists, then clears it.
  Keying on `Edit` (not `Play`) means `Paused ⇄ Play` never captures/restores,
  and the initial `Edit` entry (no snapshot yet) is a no-op — so startup never
  wipes the scene.
- **Restore = despawn + respawn.** Despawn every entity passing `keep`, then
  `spawnScene` the snapshot. `restorePlaySnapshot` returns the scene-id → entity
  map; `installPlayModeSnapshot` forwards it via an `onRestore` callback so the
  studio can remap its selection (raw-`Entity`-keyed) across the round-trip.

Layered API: `captureSnapshot` / `restoreSnapshot` operate on a `World` +
`TypeRegistry` (renderer-free, unit-tested); `capturePlaySnapshot` /
`restorePlaySnapshot` are the `App` conveniences; `installPlayModeSnapshot(app,
{ keep, onRestore })` wires the transitions.

## Consequences

- Play becomes a true sandbox: Stop reverts authored entities to their pre-play
  state, discarding play-time spawns/edits, with editor infra untouched.
- The core is a pure `World`-level round-trip, unit-tested with no studio or GPU;
  the transition wiring + selection remap are thin studio-facing glue.
- Not reverting resources in v1 is a deliberate, documented scope line (avoids
  clobbering editor/runtime resources), revisited if a game needs resource revert.
- Fresh-id remapping is surfaced (not hidden), so the studio's selection/inspector
  survive the round-trip once wired — the remaining studio-side integration.
- `Step` (advance one frame while `Paused`) and the studio toolbar/inspector
  wiring build on this mechanism and are tracked separately.

## Implementation

- `packages/editor-sdk/src/play-snapshot.ts` — `captureSnapshot` / `restoreSnapshot`
  (World-level), `capturePlaySnapshot` / `restorePlaySnapshot` (App-level),
  `installPlayModeSnapshot`, `PlaySnapshotStore`.
- Builds on `serializeWorld` (entity `filter`), `spawnScene` / `deserializeScene`,
  and `App.onExit` / `onEnter` against `SimState` (`@retro-engine/editor-sdk`).
