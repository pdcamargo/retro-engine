/**
 * Pausable, scalable game clock. Gameplay code reads `delta` and `elapsed`
 * through `Res(Time).virtual`; mutating `paused` or `scale` requires
 * `ResMut(Time)`.
 *
 * - `delta` — seconds elapsed since the previous frame. Zero on the first
 *   frame after construction, and zero on any frame where `paused` is true.
 *   Otherwise scaled by `scale`.
 * - `elapsed` — running total of `delta` since construction. Does not advance
 *   while `paused` is true.
 * - `paused` — when true, freezes `delta` to 0 and stops `elapsed` advancing.
 *   The real clock is unaffected.
 * - `scale` — multiplier applied to `delta`. `0.5` runs at half speed; `2`
 *   runs at double speed. Defaults to `1`.
 */
export interface VirtualClock {
  delta: number;
  elapsed: number;
  paused: boolean;
  scale: number;
}

/**
 * Wall-clock game time. Never paused, never scaled. Read for cutscenes,
 * audio sync, animation that should not be affected by a game-paused state.
 *
 * - `delta` — seconds elapsed since the previous frame. Zero on the first
 *   frame after construction.
 * - `elapsed` — running total of `delta` since construction.
 */
export interface RealClock {
  delta: number;
  elapsed: number;
}

/**
 * Engine clock resource. Auto-registered on `App` construction; gameplay
 * code reads it via `Res(Time)` and writes (pause / scale) via `ResMut(Time)`.
 *
 * Units throughout the public API are **seconds-as-numbers**, so a 60fps frame
 * yields `delta ≈ 0.0167`. The internal timestamp passed to `tick` is a
 * `performance.now()`-style `DOMHighResTimeStamp` in milliseconds; conversion
 * happens once at the tick boundary.
 *
 * @example
 * ```ts
 * // Read-only (gameplay):
 * app.addSystem('update', [Res(Time)], (time) => {
 *   if (!time.virtual.paused) sprite.x += speed * time.virtual.delta;
 * });
 *
 * // Mutating pause / scale:
 * app.addSystem('update', [ResMut(Time)], (time) => {
 *   if (escapePressed) time.virtual.paused = !time.virtual.paused;
 * });
 * ```
 */
export class Time {
  /** Pausable, scalable game clock. The default for gameplay systems. */
  readonly virtual: VirtualClock = { delta: 0, elapsed: 0, paused: false, scale: 1 };
  /** Wall-clock game time. Never paused, never scaled. */
  readonly real: RealClock = { delta: 0, elapsed: 0 };
  /**
   * Monotonic frame counter. Increments every {@link Time.tick} call,
   * including across pauses. `0` before the first frame; `1` after the first
   * `App.advanceFrame` (which is what `App.run` calls on startup).
   */
  frame = 0;

  private lastMs: number | undefined = undefined;

  /**
   * **Engine-internal — do not call from gameplay code.** The engine drives
   * this from its `'first'`-stage tick system; an extra call from user code
   * would advance the clock twice in a frame and desync `frame` from the
   * rendering work that follows.
   *
   * Advances the clock by the gap from the previously seen timestamp to
   * `currentMs`. The gap is clamped to 100ms so a tab-resume,
   * debugger-pause, or any other multi-second hitch cannot fling `delta` to
   * pathological values. The first call after construction sees no prior
   * timestamp and emits `delta = 0` for both clocks; subsequent calls yield
   * the actual elapsed time.
   *
   * Pause and scale apply to `virtual` only — `real` is always raw and
   * unmodified. `frame` increments unconditionally.
   */
  tick(currentMs: number): void {
    this.frame += 1;
    if (this.lastMs === undefined) {
      this.real.delta = 0;
      this.virtual.delta = 0;
      this.lastMs = currentMs;
      return;
    }
    const rawMs = Math.max(0, currentMs - this.lastMs);
    const clampedMs = Math.min(rawMs, 100);
    const realDelta = clampedMs / 1000;
    this.real.delta = realDelta;
    this.real.elapsed += realDelta;
    if (this.virtual.paused) {
      this.virtual.delta = 0;
    } else {
      const virtualDelta = realDelta * this.virtual.scale;
      this.virtual.delta = virtualDelta;
      this.virtual.elapsed += virtualDelta;
    }
    this.lastMs = currentMs;
  }
}
