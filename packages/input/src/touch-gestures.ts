import type { Touches } from './touch';

/** Cardinal direction of a {@link SwipeGesture}, from the dominant axis of travel. */
export type SwipeDirection = 'up' | 'down' | 'left' | 'right';

/** A quick touch-and-release with little movement. Positions are target-local pixels. */
export class TapGesture {
  constructor(
    readonly x: number,
    readonly y: number,
  ) {}
}

/** A fast directional flick: a touch released after travelling far enough, quickly enough. */
export class SwipeGesture {
  constructor(
    readonly direction: SwipeDirection,
    /** Total travel from touch-down to release. */
    readonly dx: number,
    readonly dy: number,
    /** Release position (target-local pixels). */
    readonly x: number,
    readonly y: number,
  ) {}
}

/** Thresholds distinguishing a tap from a swipe from neither. */
export interface TouchGestureConfig {
  /** Max touch duration to still count as a tap (ms). */
  readonly tapMaxMs: number;
  /** Max travel to still count as a tap (target-local px). */
  readonly tapMaxDistance: number;
  /** Min travel to count as a swipe (target-local px). */
  readonly swipeMinDistance: number;
  /** Max touch duration to still count as a swipe (ms). */
  readonly swipeMaxMs: number;
}

/** Sensible defaults tuned for touchscreen interaction. */
export const DEFAULT_TOUCH_GESTURE_CONFIG: TouchGestureConfig = {
  tapMaxMs: 250,
  tapMaxDistance: 12,
  swipeMinDistance: 40,
  swipeMaxMs: 400,
};

/**
 * Per-touch tracking for the recognizer: touch id → the timestamp (ms) it began.
 * Owned by {@link import('./touch-gesture-plugin').TouchGesturePlugin}; survives
 * across frames so a gesture can be classified by duration on release.
 */
export class TouchGestureState {
  readonly starts = new Map<number, number>();
}

const dominantDirection = (dx: number, dy: number): SwipeDirection =>
  Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : dy >= 0 ? 'down' : 'up';

/**
 * Recognize taps + swipes from the current {@link Touches} state, given the
 * frame's timestamp `nowMs`. Records each new touch's start time in `state`, and
 * on the frame a touch ends classifies it by travel + duration against `config`.
 * Pure aside from mutating `state` (its whole purpose). A touch that both starts
 * and ends within a single frame is not recognized (real taps span frames).
 */
export const recognizeGestures = (
  touches: Touches,
  nowMs: number,
  state: TouchGestureState,
  config: TouchGestureConfig = DEFAULT_TOUCH_GESTURE_CONFIG,
): { taps: TapGesture[]; swipes: SwipeGesture[] } => {
  const taps: TapGesture[] = [];
  const swipes: SwipeGesture[] = [];

  // Record the start time of any newly-begun (still-active) touch.
  for (const t of touches.iter()) {
    if (touches.justStarted(t.id) && !state.starts.has(t.id)) state.starts.set(t.id, nowMs);
  }

  // Classify + retire touches that ended this frame. Deleting the current key
  // mid-iteration is safe for a Map `for…of`.
  for (const [id, startMs] of state.starts) {
    const point = touches.get(id);
    if (touches.justEnded(id)) {
      state.starts.delete(id);
      // A cancel also flags `justEnded`; only a clean lift ('ended') is a gesture.
      if (point === undefined || point.phase === 'canceled') continue;
      const dx = point.x - point.startX;
      const dy = point.y - point.startY;
      const distance = Math.hypot(dx, dy);
      const durationMs = nowMs - startMs;
      if (distance <= config.tapMaxDistance && durationMs <= config.tapMaxMs) {
        taps.push(new TapGesture(point.x, point.y));
      } else if (distance >= config.swipeMinDistance && durationMs <= config.swipeMaxMs) {
        swipes.push(new SwipeGesture(dominantDirection(dx, dy), dx, dy, point.x, point.y));
      }
    } else if (point === undefined) {
      // Vanished without an `ended` frame (e.g. canceled) — drop the stale entry.
      state.starts.delete(id);
    }
  }

  return { taps, swipes };
};
