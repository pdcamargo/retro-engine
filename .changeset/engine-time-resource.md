---
'@retro-engine/engine': minor
---

Engine `Time` resource (M2 phase 3) and the `'first'` stage / `advanceFrame` primitive that ride underneath it.

- **`Time` resource.** New `Time` class (re-exported from `@retro-engine/engine`) with a Bevy-derived virtual / real split. `time.virtual` (`delta`, `elapsed`, `paused`, `scale`) is the pausable, scalable game clock — the default for gameplay. `time.real` (`delta`, `elapsed`) is wall-clock time and is never paused or scaled. `time.frame` is a monotonic counter that increments every frame regardless of pause. Units across the public API are seconds-as-numbers (a 60fps frame yields `delta ≈ 0.0167`). The inter-frame gap is clamped to 100ms so tab-resume / debugger-pause cannot fling `delta` to multi-second values. The first frame after construction emits `delta = 0` for both clocks; subsequent frames yield the actual elapsed time.
- **Auto-registered on `App` construction.** `new App(...)` registers `Time` (no manual `app.insertResource(new Time())` needed) and an engine-internal `'first'`-stage tick system that drives it. The internal system is the first real consumer of `ResMut<Time>` end-to-end — the read/write split sealed in M2 phase 2 (`Res<T>` = `DeepReadonly<T>`, `ResMut<T>` writable) propagates recursively into the sub-clocks, so `time.virtual.paused = true` is a compile error through `Res<Time>` and an allowed mutation through `ResMut<Time>`.
- **New `'first'` stage.** `Stage` now includes `'first'`, running before `'preUpdate'`. The engine's `Time` tick lands here; user systems may register on `'first'` to run "before everything" (after the engine's internal systems in registration order).
- **New `App.advanceFrame(timestampMs?)`.** Public single-tick primitive: runs `'first'` → `'preUpdate'` → `'update'` → `'postUpdate'` → render in order, threading `timestampMs` through to the engine's `Time` tick. `App.run` is rewritten on top of it — under `requestAnimationFrame`, each callback is `t => this.advanceFrame(t)`. Tests step frames synchronously with `app.advanceFrame(16.67); app.advanceFrame(33.33);` rather than mocking rAF; consumers gain a clean "step one frame" handle for replay / time-rewind tooling.
- `VirtualClock` and `RealClock` are exported as `type` for structural annotation without importing the class.

Migration: none. The additions are purely additive — existing `App.run` semantics under rAF are unchanged.
