/**
 * How the pointer is captured:
 * - `'none'` — free pointer (the default).
 * - `'locked'` — pointer lock: the cursor is hidden and confined, and mouse
 *   motion is delivered as raw deltas. The staple for FPS / free-look mouselook.
 *
 * (Web supports only free vs. locked; `'confined'` — bounded but visible — is a
 * later desktop-only mode.)
 */
export type CursorGrab = 'none' | 'locked';

/**
 * Desired cursor state, read/written via `Res(CursorOptions)` / `ResMut`. Set it
 * from game code (typically in response to a click, since browsers only grant
 * pointer lock during a user gesture); {@link WindowPlugin} applies changes to the
 * window each frame. Runtime state (a live setting, not authored), so it is not
 * serialized.
 *
 * @example
 * ```ts
 * // Enter mouselook on click, leave it on Escape (the browser also exits on Esc).
 * app.addSystem('update', [Res(MouseButtonInput), ResMut(CursorOptions)], (mouse, cursor) => {
 *   if (mouse.justPressed('Left')) cursor.grab = 'locked';
 * });
 * ```
 */
export class CursorOptions {
  /** Whether the hardware cursor is drawn. `false` hides it (e.g. custom in-game cursor). */
  visible = true;
  /** Pointer capture mode. */
  grab: CursorGrab = 'none';
}

/**
 * The window hardware-abstraction seam for **writing** host window state (the
 * counterpart to the read-only {@link Window} sync). Decouples cursor / pointer
 * control from the DOM so the engine runs headless (a no-op backend) and a
 * non-DOM host (e.g. a native shell) can implement it. Chosen by
 * {@link WindowPlugin}.
 */
export interface WindowBackend {
  /** Apply the desired cursor visibility + grab mode to the window. */
  applyCursor(visible: boolean, grab: CursorGrab): void;
}

/** No-op {@link WindowBackend} for headless environments (tests, server worlds). */
export class HeadlessWindowBackend implements WindowBackend {
  applyCursor(_visible: boolean, _grab: CursorGrab): void {}
}

/**
 * DOM {@link WindowBackend}: toggles the target element's CSS cursor and drives
 * the Pointer Lock API. `requestPointerLock` only succeeds during a user gesture
 * (a browser rule), so set `grab: 'locked'` from a click handler; the browser may
 * also exit lock on its own (Escape), which game code should treat as `'none'`.
 */
export class DomWindowBackend implements WindowBackend {
  constructor(private readonly element: HTMLElement) {}

  applyCursor(visible: boolean, grab: CursorGrab): void {
    this.element.style.cursor = visible ? '' : 'none';
    if (grab === 'locked') {
      this.element.requestPointerLock?.();
    } else if (typeof document !== 'undefined' && document.pointerLockElement === this.element) {
      document.exitPointerLock?.();
    }
  }
}

/** The last cursor state pushed to a backend, so {@link reconcileCursor} only re-applies on change. */
export interface AppliedCursor {
  visible: boolean;
  grab: CursorGrab;
}

/**
 * Push `desired` cursor state to `backend` only when it differs from `applied`
 * (the last-applied snapshot, which this updates in place). Idempotent per frame —
 * a steady setting costs one comparison, not a DOM call. Pure over its inputs
 * (the backend is injected), so it unit-tests with a mock backend.
 */
export const reconcileCursor = (
  desired: CursorOptions,
  applied: AppliedCursor,
  backend: WindowBackend,
): void => {
  if (applied.visible === desired.visible && applied.grab === desired.grab) return;
  applied.visible = desired.visible;
  applied.grab = desired.grab;
  backend.applyCursor(desired.visible, desired.grab);
};
