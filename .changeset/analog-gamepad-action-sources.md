---
'@retro-engine/input': minor
---

feat(input): analog gamepad axes as action sources

Completes the gamepad action-map binding path (P1 input follow-up): a real analog
stick now drives an `axis` / `axis2d` action with its continuous `[-1, 1]` value,
not just the digital `positiveX`/`negativeX` legs.

- `gamepadAxis(axis)` — a new source for a stick axis or trigger (via the first
  connected pad's dead-zoned axes).
- `.stick(name, source)` / `.stick2d(name, { x, y })` — pure-analog axis / axis2d
  shorthands. `.axis` / `.axis2d` also gain an optional `analog` field, so a single
  action can carry both WASD legs and a stick — the larger-magnitude input wins.
- New `analogX` / `analogY` binding roles; `resolveActionState` reads a
  `gamepadAxes` query and folds the analog value into each axis component.

Also fixes a latent reflection gap: the `ActionBinding.device` schema now
enumerates `'gamepad'` (gamepad-button bindings from the prior slice already
produced that device but the schema rejected it on save).

Note: `ActionInputs` gains a required `gamepadAxes` field — a signature change for
anything constructing it directly.
