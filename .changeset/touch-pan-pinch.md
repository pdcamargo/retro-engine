---
'@retro-engine/input': minor
---

feat(input): pan + pinch touch gestures

Completes the touch gesture recognizers (P1 input follow-up) alongside tap +
swipe.

- `PanGesture` — a single moving touch, emitted per frame (continuous drag) with
  the touch position + per-frame delta.
- `PinchGesture` — two active touches, the incremental `scale` of their
  separation each frame (`>1` spreading apart, `<1` pinching in) plus the pinch
  center.

`recognizeGestures` now also returns `pans` + `pinches` (tracking the two-touch
distance across frames in `TouchGestureState`), and `TouchGesturePlugin` emits
them as messages. Unit-tested (pan delta only after the down frame; pinch scale
spreading/together; a single touch is a pan, never a pinch).
