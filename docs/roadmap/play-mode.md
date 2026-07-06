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

- **Restore on Stop.** ✅ **Wired into the studio + MCP-verified (2026-07-06).**
  `installPlayModeSnapshot` is now installed in the studio (`keep = !EditorOnly`),
  so Play captures the authored scene and Stop restores it. Verified via the MCP
  on a real project: a Play→edit→Stop cycle reverts an authored field
  (`Health` 150→110) and leaves the entity count unchanged (77→77) — the glTF
  character rig is no longer duplicated. That last part needed a fix:
  `capturePlaySnapshot` was capturing glTF-instantiated children verbatim (then
  restore re-instantiated them); it is now **composition-aware** (`SerializeOptions.composition`
  → `serializeWorld` → `collectComposition`), staying entity-only. Selection is
  **cleared** on restore (safe — the selected authored entity is despawned).
  **Remaining:** true selection *survival* (remap via a persistent identity, not
  the compact snapshot ids) + inspector-during-play.

- **Step.** Wire the toolbar Step button (▶⏭, currently inert) to advance exactly
  one frame while Paused. Not yet exposed as an MCP command either.

- **Inspector behavior while playing.** Today the inspector goes read-only in Play
  (a mirror of `state.playing`); revisit once gating + snapshot exist (live-edit of
  the play world vs the edit world).
