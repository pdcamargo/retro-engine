import { describe, expect, it } from 'bun:test';

import { HeadlessInputBackend } from './dom-backend';
import { KeyboardInput } from './keyboard';
import { CursorPosition, MouseButtonInput, MouseMotion, MouseScroll, mouseButtonFromIndex } from './mouse';
import { applyInputFrame, InputPlugin } from './input-plugin';
import type { InputBackend, RawInputEvent } from './raw-event';

/** A backend whose next-drain events are set per frame; drains exactly once. */
class QueueBackend implements InputBackend {
  private next: readonly RawInputEvent[] = [];
  attach(): void {}
  detach(): void {}
  push(events: readonly RawInputEvent[]): void {
    this.next = events;
  }
  drain(): readonly RawInputEvent[] {
    const out = this.next;
    this.next = [];
    return out;
  }
}

interface Frame {
  readonly backend: QueueBackend;
  readonly keyboard: KeyboardInput;
  readonly mouseButtons: MouseButtonInput;
  readonly motion: MouseMotion;
  readonly scroll: MouseScroll;
  readonly cursor: CursorPosition;
  step(events?: readonly RawInputEvent[]): void;
}

const makeFrame = (): Frame => {
  const backend = new QueueBackend();
  const keyboard = new KeyboardInput();
  const mouseButtons = new MouseButtonInput();
  const motion = new MouseMotion();
  const scroll = new MouseScroll();
  const cursor = new CursorPosition();
  return {
    backend,
    keyboard,
    mouseButtons,
    motion,
    scroll,
    cursor,
    step(events: readonly RawInputEvent[] = []) {
      backend.push(events);
      applyInputFrame(backend, keyboard, mouseButtons, motion, scroll, cursor);
    },
  };
};

describe('applyInputFrame — keyboard', () => {
  it('key-down presses; justPressed only on the press frame', () => {
    const f = makeFrame();
    f.step([{ kind: 'key-down', code: 'KeyW', repeat: false }]);
    expect(f.keyboard.pressed('KeyW')).toBe(true);
    expect(f.keyboard.justPressed('KeyW')).toBe(true);
    // Next frame: still held, no longer just-pressed.
    f.step();
    expect(f.keyboard.pressed('KeyW')).toBe(true);
    expect(f.keyboard.justPressed('KeyW')).toBe(false);
  });

  it('key-repeat does not re-fire justPressed', () => {
    const f = makeFrame();
    f.step([{ kind: 'key-down', code: 'KeyW', repeat: false }]);
    f.step([{ kind: 'key-down', code: 'KeyW', repeat: true }]);
    expect(f.keyboard.justPressed('KeyW')).toBe(false);
    expect(f.keyboard.pressed('KeyW')).toBe(true);
  });

  it('key-up releases; justReleased only on the release frame', () => {
    const f = makeFrame();
    f.step([{ kind: 'key-down', code: 'KeyW', repeat: false }]);
    f.step([{ kind: 'key-up', code: 'KeyW' }]);
    expect(f.keyboard.pressed('KeyW')).toBe(false);
    expect(f.keyboard.justReleased('KeyW')).toBe(true);
    f.step();
    expect(f.keyboard.justReleased('KeyW')).toBe(false);
  });

  it('blur releases all held keys and mouse buttons', () => {
    const f = makeFrame();
    f.step([
      { kind: 'key-down', code: 'KeyW', repeat: false },
      { kind: 'key-down', code: 'KeyA', repeat: false },
      { kind: 'mouse-down', button: 0 },
    ]);
    f.step([{ kind: 'blur' }]);
    expect(f.keyboard.pressed('KeyW')).toBe(false);
    expect(f.keyboard.pressed('KeyA')).toBe(false);
    expect(f.keyboard.justReleased('KeyW')).toBe(true);
    expect(f.mouseButtons.pressed('Left')).toBe(false);
    expect(f.mouseButtons.justReleased('Left')).toBe(true);
  });
});

describe('applyInputFrame — mouse buttons', () => {
  it('maps button indices and tracks press/release', () => {
    const f = makeFrame();
    f.step([
      { kind: 'mouse-down', button: 0 },
      { kind: 'mouse-down', button: 2 },
    ]);
    expect(f.mouseButtons.pressed('Left')).toBe(true);
    expect(f.mouseButtons.pressed('Right')).toBe(true);
    expect(f.mouseButtons.justPressed('Left')).toBe(true);
  });

  it('ignores unknown button indices', () => {
    const f = makeFrame();
    f.step([{ kind: 'mouse-down', button: 42 }]);
    expect([...f.mouseButtons.getPressed()]).toEqual([]);
  });
});

describe('applyInputFrame — motion / scroll / cursor', () => {
  it('accumulates motion within a frame and zeroes it next frame', () => {
    const f = makeFrame();
    f.step([
      { kind: 'mouse-move', x: 10, y: 20, dx: 3, dy: 4, present: true },
      { kind: 'mouse-move', x: 12, y: 26, dx: 2, dy: 6, present: true },
    ]);
    expect(f.motion.x).toBe(5);
    expect(f.motion.y).toBe(10);
    expect(f.cursor.x).toBe(12);
    expect(f.cursor.y).toBe(26);
    expect(f.cursor.present).toBe(true);
    // Deltas reset next frame even with no movement.
    f.step();
    expect(f.motion.x).toBe(0);
    expect(f.motion.y).toBe(0);
    // Cursor position persists (last-known).
    expect(f.cursor.x).toBe(12);
  });

  it('accumulates wheel and records the unit; cursor-leave clears present', () => {
    const f = makeFrame();
    f.step([
      { kind: 'wheel', dx: 0, dy: 3, unit: 'line' },
      { kind: 'wheel', dx: 1, dy: 2, unit: 'line' },
      { kind: 'mouse-move', x: 5, y: 5, dx: 0, dy: 0, present: true },
      { kind: 'cursor-leave' },
    ]);
    expect(f.scroll.x).toBe(1);
    expect(f.scroll.y).toBe(5);
    expect(f.scroll.unit).toBe('line');
    expect(f.cursor.present).toBe(false);
    f.step();
    expect(f.scroll.y).toBe(0);
  });
});

describe('mouseButtonFromIndex', () => {
  it('maps the standard indices', () => {
    expect(mouseButtonFromIndex(0)).toBe('Left');
    expect(mouseButtonFromIndex(1)).toBe('Middle');
    expect(mouseButtonFromIndex(2)).toBe('Right');
    expect(mouseButtonFromIndex(3)).toBe('Back');
    expect(mouseButtonFromIndex(4)).toBe('Forward');
    expect(mouseButtonFromIndex(9)).toBeNull();
  });
});

describe('HeadlessInputBackend', () => {
  it('never produces events', () => {
    const backend = new HeadlessInputBackend();
    backend.attach();
    expect(backend.drain()).toEqual([]);
    backend.detach();
  });
});

describe('InputPlugin — backend selection', () => {
  it('uses a headless backend when no window is present (test env)', () => {
    // bun:test has no DOM, so the default backend is headless.
    const plugin = new InputPlugin();
    expect(plugin.getBackend()).toBeInstanceOf(HeadlessInputBackend);
  });

  it('uses an injected backend when supplied', () => {
    const backend = new HeadlessInputBackend();
    const plugin = new InputPlugin({ backend });
    expect(plugin.getBackend()).toBe(backend);
  });
});
