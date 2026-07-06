---
'@retro-engine/input': minor
---

feat(input): Phase 4 — touch (`Touches` resource)

Touch input via the existing event-drain backend (ADR-0144), completing the P0 input surface (keyboard + mouse + action map + gamepad + touch).

**New public surface:**

- `Touches` — resource of active `TouchPoint`s, read via `Res(Touches)`. `iter()` / `first()` / `count()` / `get(id)`, plus `justStarted(id)` / `justEnded(id)` / `anyJustStarted()`. Mirrors the `ButtonInput` per-frame lifecycle: transition sets and per-frame deltas are valid only for the current frame.
- `TouchPoint` — `id`, current `x`/`y` and `startX`/`startY` (target-local pixels), per-frame `deltaX`/`deltaY`, and `phase` (`started` / `moved` / `stationary` / `ended` / `canceled`).
- `TouchPhase` type.

`DomInputBackend` now emits `touch-start` / `touch-move` / `touch-end` / `touch-cancel` events (per changed touch, coordinates mapped to the pointer target, `preventDefault` on start/move gated by `preventDefaults`), and `applyInputFrame` folds them into `Touches` in the same `preUpdate` step as keyboard/mouse. Transient — not serialized. Gesture recognizers (tap/pan/pinch/swipe) are a P1 follow-up; touch works in any browser today (mobile *export* still needs the WebGL2 backend).
