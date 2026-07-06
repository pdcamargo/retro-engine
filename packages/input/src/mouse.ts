import { ButtonInput } from './button-input';

/**
 * A mouse button, normalized from the DOM `MouseEvent.button` index:
 * `0 → Left`, `1 → Middle`, `2 → Right`, `3 → Back`, `4 → Forward`.
 */
export type MouseButton = 'Left' | 'Right' | 'Middle' | 'Back' | 'Forward';

/** Map a DOM `MouseEvent.button` index to a {@link MouseButton}, or `null` if unknown. */
export const mouseButtonFromIndex = (index: number): MouseButton | null => {
  switch (index) {
    case 0:
      return 'Left';
    case 1:
      return 'Middle';
    case 2:
      return 'Right';
    case 3:
      return 'Back';
    case 4:
      return 'Forward';
    default:
      return null;
  }
};

/**
 * Per-frame mouse button state, read via `Res(MouseButtonInput)`. A concrete
 * subclass of {@link ButtonInput} keyed on {@link MouseButton}, distinct from
 * {@link KeyboardInput} so both live in the resource map at once.
 */
export class MouseButtonInput extends ButtonInput<MouseButton> {}

/**
 * Relative pointer movement accumulated over the current frame, read via
 * `Res(MouseMotion)`. `x`/`y` are the summed deltas since the previous frame
 * (device pixels; positive `x` is rightward, positive `y` is downward), zeroed
 * at the start of each frame. Frames with no movement report `(0, 0)`.
 */
export class MouseMotion {
  /** Summed horizontal movement this frame. */
  x = 0;
  /** Summed vertical movement this frame. */
  y = 0;

  /** @internal Reset to zero at the start of each frame. */
  clear(): void {
    this.x = 0;
    this.y = 0;
  }
}

/**
 * The unit of a {@link MouseScroll} delta, from `WheelEvent.deltaMode`:
 * `'pixel'` (0), `'line'` (1), or `'page'` (2). Most mouse wheels report
 * `'line'`; trackpads and smooth-scroll wheels report `'pixel'`.
 */
export type MouseScrollUnit = 'pixel' | 'line' | 'page';

/**
 * Wheel / scroll delta accumulated over the current frame, read via
 * `Res(MouseScroll)`. `x`/`y` are summed since the previous frame and zeroed
 * each frame; `unit` reflects the most recent wheel event's `deltaMode`.
 */
export class MouseScroll {
  /** Summed horizontal scroll this frame. */
  x = 0;
  /** Summed vertical scroll this frame (positive is scroll-down / away). */
  y = 0;
  /** Unit of the accumulated delta, from the latest wheel event. */
  unit: MouseScrollUnit = 'pixel';

  /** @internal Reset to zero at the start of each frame (unit is left as-is). */
  clear(): void {
    this.x = 0;
    this.y = 0;
  }
}

/**
 * The cursor's current position, read via `Res(CursorPosition)`. `x`/`y` are in
 * pixels relative to the plugin's pointer target (the game canvas when one was
 * supplied, else the browser viewport). `present` is false when the pointer has
 * left the target (or has not moved over it yet), in which case `x`/`y` hold the
 * last known position.
 */
export class CursorPosition {
  /** Horizontal position in target-local pixels. */
  x = 0;
  /** Vertical position in target-local pixels. */
  y = 0;
  /** Whether the cursor is currently over the pointer target. */
  present = false;
}
