import type { MouseScrollUnit } from './mouse';
import type { InputBackend, RawInputEvent } from './raw-event';

/** Options for {@link DomInputBackend}. */
export interface DomInputBackendOptions {
  /**
   * Element the cursor position is reported relative to (typically the game
   * canvas). When omitted, positions are reported in browser-viewport pixels
   * and the cursor is always considered "present."
   */
  readonly pointerTarget?: HTMLElement;
  /**
   * Target for keyboard listeners. Defaults to `window`. Pointer and wheel
   * listeners always attach to `window` so drags that leave the target still
   * track.
   */
  readonly keyboardTarget?: Window | HTMLElement;
  /**
   * Call `preventDefault()` on wheel and context-menu events so game input does
   * not scroll the page or pop the browser menu. Defaults to `true`.
   */
  readonly preventDefaults?: boolean;
}

const wheelUnit = (deltaMode: number): MouseScrollUnit =>
  deltaMode === 1 ? 'line' : deltaMode === 2 ? 'page' : 'pixel';

/**
 * {@link InputBackend} backed by DOM events. Attaches keyboard listeners to a
 * keyboard target (default `window`) and pointer/wheel listeners to `window`,
 * normalizing each into a {@link RawInputEvent} queued for the next drain.
 *
 * Cursor coordinates are mapped into the `pointerTarget` element's local pixel
 * space when one is supplied. `attach()` is idempotent, so re-adding the owning
 * plugin cannot leak duplicate listeners.
 */
export class DomInputBackend implements InputBackend {
  private readonly pointerTarget: HTMLElement | undefined;
  private readonly keyboardTarget: Window | HTMLElement;
  private readonly preventDefaults: boolean;

  private queue: RawInputEvent[] = [];
  private attached = false;
  private lastX = 0;
  private lastY = 0;
  /** Registered listeners, retained so {@link detach} can remove exactly these. */
  private readonly bindings: Array<{
    readonly target: Window | HTMLElement;
    readonly type: string;
    readonly handler: EventListener;
    readonly options?: AddEventListenerOptions;
  }> = [];

  constructor(options: DomInputBackendOptions = {}) {
    this.pointerTarget = options.pointerTarget;
    this.keyboardTarget = options.keyboardTarget ?? globalThis.window;
    this.preventDefaults = options.preventDefaults ?? true;
  }

  attach(): void {
    if (this.attached) return;
    this.attached = true;
    const win = globalThis.window;

    this.bind(this.keyboardTarget, 'keydown', (e) => {
      const ev = e as KeyboardEvent;
      this.queue.push({ kind: 'key-down', code: ev.code, repeat: ev.repeat });
    });
    this.bind(this.keyboardTarget, 'keyup', (e) => {
      this.queue.push({ kind: 'key-up', code: (e as KeyboardEvent).code });
    });

    this.bind(win, 'mousedown', (e) => {
      this.queue.push({ kind: 'mouse-down', button: (e as MouseEvent).button });
    });
    this.bind(win, 'mouseup', (e) => {
      this.queue.push({ kind: 'mouse-up', button: (e as MouseEvent).button });
    });
    this.bind(win, 'mousemove', (e) => {
      const ev = e as MouseEvent;
      const { x, y, present } = this.localCursor(ev);
      const dx = ev.movementX || x - this.lastX;
      const dy = ev.movementY || y - this.lastY;
      this.lastX = x;
      this.lastY = y;
      this.queue.push({ kind: 'mouse-move', x, y, dx, dy, present });
    });
    this.bind(
      win,
      'wheel',
      (e) => {
        const ev = e as WheelEvent;
        if (this.preventDefaults) ev.preventDefault();
        this.queue.push({ kind: 'wheel', dx: ev.deltaX, dy: ev.deltaY, unit: wheelUnit(ev.deltaMode) });
      },
      { passive: !this.preventDefaults },
    );
    this.bind(win, 'blur', () => {
      this.queue.push({ kind: 'blur' });
    });

    const leaveTarget = this.pointerTarget ?? win;
    this.bind(leaveTarget, 'mouseleave', () => {
      this.queue.push({ kind: 'cursor-leave' });
    });
    this.bind(this.pointerTarget ?? win, 'contextmenu', (e) => {
      if (this.preventDefaults) e.preventDefault();
    });
  }

  detach(): void {
    if (!this.attached) return;
    for (const b of this.bindings) b.target.removeEventListener(b.type, b.handler, b.options);
    this.bindings.length = 0;
    this.queue = [];
    this.attached = false;
  }

  drain(): readonly RawInputEvent[] {
    if (this.queue.length === 0) return EMPTY;
    const out = this.queue;
    this.queue = [];
    return out;
  }

  private bind(
    target: Window | HTMLElement,
    type: string,
    handler: EventListener,
    options?: AddEventListenerOptions,
  ): void {
    target.addEventListener(type, handler, options);
    this.bindings.push(options ? { target, type, handler, options } : { target, type, handler });
  }

  private localCursor(ev: MouseEvent): { x: number; y: number; present: boolean } {
    if (this.pointerTarget === undefined) {
      return { x: ev.clientX, y: ev.clientY, present: true };
    }
    const rect = this.pointerTarget.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    const present = x >= 0 && y >= 0 && x <= rect.width && y <= rect.height;
    return { x, y, present };
  }
}

const EMPTY: readonly RawInputEvent[] = Object.freeze([]);

/**
 * No-op {@link InputBackend} for headless environments (tests, server-side
 * worlds) where no `window` exists. Never queues events; every {@link drain}
 * returns empty. `InputPlugin` installs this automatically when `window` is
 * absent.
 */
export class HeadlessInputBackend implements InputBackend {
  attach(): void {}
  detach(): void {}
  drain(): readonly RawInputEvent[] {
    return EMPTY;
  }
}
