---
'@retro-engine/engine': minor
---

feat(engine): `Window` resource + `WindowResized` event (P1 windowing, phase 1)

Adds the read side of windowing: a `Window` resource mirroring the drawing
surface, so game code reads the logical size (for camera aspect, UI layout,
pointer math) without reaching for DOM globals — keeping it headless-safe.

- `Window` resource: `width` / `height` (logical CSS px), `physicalWidth` /
  `physicalHeight` (backing px), `devicePixelRatio`.
- `WindowResized` message, emitted the frame the logical size changes (incl. the
  first frame it becomes known) — read with `MessageReader(WindowResized)`.
- `syncWindow(window, physicalW, physicalH, dpr)` pure fold (returns whether the
  logical size changed), and an opt-in `WindowPlugin` that inserts the resource
  and syncs it from the surface each frame in `'first'`, emitting `WindowResized`
  on change. Headless-safe (no surface → no-op).

Unit-tested (dpr division, change detection, dpr guard) + a capturing-renderer
integration test (Window reflects the surface; `WindowResized` fires once on
first sight, not on a steady size). Cursor / fullscreen / present-mode /
multi-window remain follow-ups.
