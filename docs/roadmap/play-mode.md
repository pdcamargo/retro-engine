# Play mode

The studio can enter Play / Pause / Edit via `SimState` (ADR-0087), and the engine
exposes the schedule, per-system enable/disable, and profiling (ADR-0086). What's
left is making play mode *do* something: run gameplay only while playing, and
return the scene to its pre-play state on stop. Deferred because there's no user
gameplay code loaded in the studio yet, and snapshot/restore is its own slice.

## Work items (promote to `backlog/` when picked up)

- **System gating by `SimState`.** Decide and implement the policy for which
  systems run in each state. Options: explicit `runIf: inState(SimState.Play)` on
  gameplay systems; an implicit rule keyed on `origin: 'user'` (engine/editor always
  run, user systems only in Play/Paused); or a per-system opt-in flag. `Paused`
  should freeze gameplay while keeping editor + render systems live. Needs a
  decision ADR.

- **World snapshot on Play.** Serialize the editable world (or clone it) when
  entering Play, so edits made while playing are transient.

- **Restore on Stop.** Re-apply the snapshot when returning to Edit, discarding
  play-time mutations. Interacts with the reflection/serialization path
  (ADR-0060/0061) and edit history (ADR-0082).

- **Step.** Wire the toolbar Step button to advance exactly one (fixed?) frame
  while Paused.

- **Inspector behavior while playing.** Today the inspector goes read-only in Play
  (a mirror of `state.playing`); revisit once gating + snapshot exist (live-edit of
  the play world vs the edit world).
