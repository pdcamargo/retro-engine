import { describe, expect, it } from 'bun:test';

import { App, MessageReader, Window, WindowPlugin, WindowResized, syncWindow } from './index';
import { makeCapturingRenderer, makeStubCanvas } from './test-utils';

describe('syncWindow', () => {
  it('records physical size + dpr and derives the logical size', () => {
    const w = new Window();
    const changed = syncWindow(w, 1280, 720, 1);
    expect(changed).toBe(true);
    expect([w.width, w.height]).toEqual([1280, 720]);
    expect([w.physicalWidth, w.physicalHeight]).toEqual([1280, 720]);
    expect(w.devicePixelRatio).toBe(1);
  });

  it('divides physical by dpr for the logical size', () => {
    const w = new Window();
    syncWindow(w, 2560, 1440, 2);
    expect([w.width, w.height]).toEqual([1280, 720]);
    expect([w.physicalWidth, w.physicalHeight]).toEqual([2560, 1440]);
    expect(w.devicePixelRatio).toBe(2);
  });

  it('returns false when the logical size is unchanged', () => {
    const w = new Window();
    syncWindow(w, 800, 600, 1);
    expect(syncWindow(w, 800, 600, 1)).toBe(false);
    expect(syncWindow(w, 900, 600, 1)).toBe(true); // width changed
  });

  it('guards a non-positive dpr (treated as 1)', () => {
    const w = new Window();
    syncWindow(w, 640, 480, 0);
    expect([w.width, w.height]).toEqual([640, 480]);
    expect(w.devicePixelRatio).toBe(1);
  });
});

describe('WindowPlugin (integration)', () => {
  it('syncs the Window from the surface and emits WindowResized on first sight', async () => {
    const { renderer } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.addPlugin(new WindowPlugin());
    const resizes: { width: number; height: number }[] = [];
    app.addSystem('last', [MessageReader(WindowResized)], (events) => {
      for (const e of events) resizes.push({ width: (e as WindowResized).width, height: (e as WindowResized).height });
    });

    await app.run(); // async renderer init creates the surface, then runs the schedule

    const surface = app.getSurface()!;
    const win = app.getResource(Window)!;
    // Headless dpr is 1, so logical == physical == the surface's backing size.
    expect(win.physicalWidth).toBe(surface.width);
    expect(win.width).toBe(surface.width);
    expect(win.width).toBeGreaterThan(0);
    expect(resizes).toHaveLength(1); // resized once, on first sight
    expect(resizes[0]!.width).toBe(win.width);

    // Steady size → no further WindowResized.
    app.advanceFrame(16);
    expect(resizes).toHaveLength(1);
  });
});
