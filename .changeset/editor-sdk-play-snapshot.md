---
'@retro-engine/editor-sdk': minor
---

feat(editor-sdk): play-mode snapshot / restore core (play mode phase 1)

Makes play mode a revertible sandbox. Adds:

- `captureSnapshot` / `restoreSnapshot` — serialize the authored entities (those
  passing a `keep` filter, excluding editor infra) and revert a `World` to a
  snapshot by despawning current authored entities and respawning it. World-level
  and renderer-free; returns the snapshot-id → new-`Entity` map for id remapping.
- `capturePlaySnapshot` / `restorePlaySnapshot` — the `App` conveniences
  (respawn via `spawnScene` so asset handles resolve through the App's stores).
- `installPlayModeSnapshot(app, { keep, onRestore })` — wires snapshot on
  `onExit(SimState.Edit)` and restore on `onEnter(SimState.Edit)`, so leaving
  Edit captures and returning restores; `Paused ⇄ Play` and the initial Edit
  entry are no-ops. `onRestore` forwards the id map for selection remapping.

v1 reverts authored entities, not resources (ADR-0152). Studio toolbar wiring,
selection remap, and Step build on this.
