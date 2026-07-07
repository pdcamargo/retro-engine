import { describe, expect, it } from 'bun:test';

import {
  type AppliedCursor,
  type CursorGrab,
  CursorOptions,
  DomWindowBackend,
  HeadlessWindowBackend,
  reconcileCursor,
  type WindowBackend,
} from './index';

/** Records every applyCursor call. */
class MockWindowBackend implements WindowBackend {
  readonly calls: [boolean, CursorGrab][] = [];
  applyCursor(visible: boolean, grab: CursorGrab): void {
    this.calls.push([visible, grab]);
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
});

describe('HeadlessWindowBackend', () => {
  it('is a no-op and never throws', () => {
    expect(() => new HeadlessWindowBackend().applyCursor(false, 'locked')).not.toThrow();
  });
});
