# Play mode

The studio can enter Play / Pause / Edit via `SimState` (ADR-0087), and the engine
exposes the schedule, per-system enable/disable, and profiling (ADR-0086). What's
left is making play mode *do* something: run gameplay only while playing, and
return the scene to its pre-play state on stop. Deferred because there's no user
gameplay code loaded in the studio yet, and snapshot/restore is its own slice.

Snapshot/restore core + gating policy shipped 2026-07-06 (ADR-0152). See below.

## Work items (promote to `backlog/` when picked up)

- **System gating by `SimState`.** ✅ Policy decided (ADR-0152): user project
  systems run only `inState(SimState.Play)`; engine + editor systems always run;
  `Paused` = "not Play" so gameplay freezes while editor + render stay live.

- **World snapshot on Play.** ✅ `captureSnapshot`/`capturePlaySnapshot`
  (`@retro-engine/editor-sdk`) serialize the authored entities (excluding editor
  infra via a `keep` filter) when leaving Edit.

- **Restore on Stop.** ✅ `restoreSnapshot`/`restorePlaySnapshot` despawn authored
  entities + respawn the snapshot on entering Edit; `installPlayModeSnapshot`
  wires both to the `SimState` transitions and forwards the id-remap map.
  Entity-only revert in v1 (resources persist). Renderer-free, unit-tested.
  **Remaining:** wire into the studio toolbar + remap selection via the id map +
  inspector-during-play — MCP-verified.

- **Step.** Wire the toolbar Step button to advance exactly one (fixed?) frame
  while Paused.

- **Inspector behavior while playing.** Today the inspector goes read-only in Play
  (a mirror of `state.playing`); revisit once gating + snapshot exist (live-edit of
  the play world vs the edit world).
