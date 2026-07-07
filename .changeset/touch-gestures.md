---
'@retro-engine/input': minor
---

feat(input): touch gesture recognizers — tap + swipe

Adds tap/swipe gesture recognition on top of `Touches` (P1 input follow-up).

- `recognizeGestures(touches, nowMs, state, config)` — a pure recognizer that
  records each touch's start time and, on release, classifies it by travel +
  duration into a `TapGesture` (quick, still) or a directional `SwipeGesture`
  (far, fast; up/down/left/right from the dominant axis). Canceled touches emit
  nothing. Tunable via `TouchGestureConfig` (`DEFAULT_TOUCH_GESTURE_CONFIG`).
- `TouchGesturePlugin` (opt-in) runs it in `preUpdate` right after the input
  drain and emits `TapGesture` / `SwipeGesture` messages — read with
  `MessageReader`. Requires `InputPlugin` (for `Touches`).

Unit-tested: tap, swipe direction (incl. dominant-axis selection), the
neither-case (too slow / too short), a far-but-slow drag rejected as a swipe,
and canceled touches dropped without a late gesture.
