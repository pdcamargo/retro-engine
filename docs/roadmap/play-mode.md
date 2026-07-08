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

- **Step.** ✅ **Shipped + MCP-verified (2026-07-06).** `SimStep` resource +
  `installSimStep` (`@retro-engine/editor-sdk`) open a one-frame `active` window
  in the `'first'` stage; the studio composes the play gate as
  `inState(SimState.Play).or(simStepActive())`, so a queued step runs gameplay for
  exactly one frame **without leaving `Paused`** (no `state.playing`/inspector
  churn). Wired to the toolbar Step button + the `studio.step` MCP command;
  `requestSimStep` is a no-op unless paused. Verified live: a paused gameplay
  `Health` regen stayed frozen across many frames, then advanced +1/frame per
  step, linearly (41→42→43), with `simState` staying `Paused`.
  - **Follow-up (fixed timestep).** The gate opens variable-`update` gameplay for
    one frame. A stepped frame could also run *accumulated* `fixedUpdate` steps as
    a catch-up burst if the fixed accumulator advanced while paused (mirrors
    ordinary pause→resume). Latent today (the sample has no `fixedUpdate`
    gameplay); revisit by freezing the fixed accumulator while not playing.

- **Inspector behavior while playing.** ✅ **Shipped + MCP-verified (2026-07-08).**
  The inspector stays **live and editable** during play. Field values refresh every
  frame (immediate-mode read of the live component), so a value a system mutates —
  e.g. a `Health` regen — is seen updating in real time. Play-time field writes go
  through a **direct (no-history) emitter** instead of the undo history, so Stop's
  snapshot/restore cleanly discards them: a play-time tweak never leaks into the
  authored scene and never corrupts the edit-world undo stack. Structural edits
  (Add Component) are disabled while playing — they would either be reverted on Stop
  or corrupt the undo stack. In Edit mode nothing changes: writes remain undoable.
  Verified end-to-end via the MCP: selecting `Hero`, entering Play, watching
  `Health.current` climb 110→150 in the inspector as the regen ran, then Stop
  reverting it to 110.
  - **Follow-up (selection survival).** Restore still remaps entity ids and clears
    the selection; surviving the selection across a Play→Stop cycle (remap via a
    persistent identity, not the compact snapshot ids) is a separate slice.
