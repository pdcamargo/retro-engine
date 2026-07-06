---
'@retro-engine/editor-sdk': minor
'@retro-engine/editor-mcp': minor
---

feat(editor-sdk): play-mode Step — advance exactly one frame while paused

Adds "Step" to play mode: advance the simulation exactly one frame while
`SimState.Paused`, without ever leaving the paused state.

- `@retro-engine/editor-sdk`: new `SimStep` resource + `installSimStep(app)`,
  `requestSimStep(app)`, and `simStepActive()`. `installSimStep` runs a `'first'`
  stage system that opens a one-frame `active` window when a step is queued.
  Compose the play gate as `inState(SimState.Play).or(simStepActive())` so
  gameplay systems run while playing *or* for a single stepped frame. Stepping
  is a no-op unless paused (meaningless while editing or already playing).
- `@retro-engine/editor-mcp`: new `studio.step` command drives it over MCP.

The paused state never changes during a step, so `state.playing`/`paused`
mirrors and the inspector's play-mode behavior don't churn.
