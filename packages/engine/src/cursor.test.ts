import { describe, expect, it } from 'bun:test';

import {
  type AppliedCursor,
  type AppliedWindowMode,
  type CursorGrab,
  CursorOptions,
  DomWindowBackend,
  HeadlessWindowBackend,
  reconcileCursor,
  reconcileWindowMode,
  type WindowBackend,
  WindowMode,
} from './index';

/** Records every applyCursor / setFullscreen call. */
class MockWindowBackend implements WindowBackend {
  readonly calls: [boolean, CursorGrab][] = [];
  readonly fullscreens: boolean[] = [];
  applyCursor(visible: boolean, grab: CursorGrab): void {
    this.calls.push([visible, grab]);
  }
  setFullscreen(fullscreen: boolean): void {
    this.fullscreens.push(fullscreen);
  }
}

describe('reconcileCursor', () => {
  it('applies only when the desired state changes, updating the snapshot', () => {
    const backend = new MockWindowBackend();
    const applied: AppliedCursor = { visible: true, grab: 'none' };
    const opts = new CursorOptions(); // defaults: visible, none

    reconcileCursor(opts, applied, backend); // matches the snapshot → no call
    expect(backend.calls).toHaveLength(0);

    opts.grab = 'locked';
    reconcileCursor(opts, applied, backend);
    expect(backend.calls).toEqual([[true, 'locked']]);
    expect(applied).toEqual({ visible: true, grab: 'locked' });

    reconcileCursor(opts, applied, backend); // unchanged → still one call
    expect(backend.calls).toHaveLength(1);

    opts.visible = false;
    reconcileCursor(opts, applied, backend);
    expect(backend.calls[1]).toEqual([false, 'locked']);
  });
});

describe('reconcileWindowMode', () => {
  it('applies fullscreen only when it changes, updating the snapshot', () => {
    const backend = new MockWindowBackend();
    const applied: AppliedWindowMode = { fullscreen: false };
    const mode = new WindowMode();

    reconcileWindowMode(mode, applied, backend); // false == false → no call
    expect(backend.fullscreens).toHaveLength(0);

    mode.fullscreen = true;
    reconcileWindowMode(mode, applied, backend);
    expect(backend.fullscreens).toEqual([true]);
    expect(applied.fullscreen).toBe(true);

    reconcileWindowMode(mode, applied, backend); // unchanged → still one call
    expect(backend.fullscreens).toHaveLength(1);

    mode.fullscreen = false;
    reconcileWindowMode(mode, applied, backend);
    expect(backend.fullscreens).toEqual([true, false]);
  });
});

describe('DomWindowBackend', () => {
  it('toggles the element cursor and requests pointer lock on lock', () => {
    let lockRequests = 0;
    const el = {
      style: { cursor: 'auto' },
      requestPointerLock: () => {
        lockRequests += 1;
      },
    } as unknown as HTMLElement;
    const backend = new DomWindowBackend(el);

    backend.applyCursor(false, 'locked');
    expect(el.style.cursor).toBe('none');
    expect(lockRequests).toBe(1);

    backend.applyCursor(true, 'none');
    expect(el.style.cursor).toBe(''); // visible → default cursor
  });

  it('requests fullscreen on the element when entering fullscreen', () => {
    let fsRequests = 0;
    const el = {
      style: { cursor: '' },
      requestFullscreen: () => {
        fsRequests += 1;
        return Promise.resolve();
      },
    } as unknown as HTMLElement;
    new DomWindowBackend(el).setFullscreen(true);
    expect(fsRequests).toBe(1);
  });
});

describe('HeadlessWindowBackend', () => {
  it('is a no-op and never throws', () => {
    const b = new HeadlessWindowBackend();
    expect(() => b.applyCursor(false, 'locked')).not.toThrow();
    expect(() => b.setFullscreen(true)).not.toThrow();
  });
});
