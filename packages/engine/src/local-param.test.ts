import { describe, expect, it } from 'bun:test';

import { App, Local } from './index';
import { makeHeadlessRenderer } from './test-utils';

describe('Local (per-system persistent state)', () => {
  it('lazily seeds from the factory and persists writes across frames', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const seen: number[] = [];
    app.addSystem('update', [Local(() => 10)], (frame) => {
      frame.current += 1;
      seen.push(frame.current);
    });

    app.advanceFrame(0);
    app.advanceFrame(16);
    app.advanceFrame(32);

    // Seeded at 10 on first run, +1 each frame, carried over between frames.
    expect(seen).toEqual([11, 12, 13]);
  });

  it('gives each system its own slot (two Locals do not share)', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    let a = 0;
    let b = 0;
    app.addSystem('update', [Local(() => 0)], (l) => {
      l.current += 1;
      a = l.current;
    });
    app.addSystem('update', [Local(() => 100)], (l) => {
      l.current += 1;
      b = l.current;
    });

    app.advanceFrame(0);
    app.advanceFrame(16);

    expect(a).toBe(2); // 0 → 1 → 2
    expect(b).toBe(102); // 100 → 101 → 102
  });

  it('supports a non-primitive slot (default-constructed cache)', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    let lastLen = 0;
    app.addSystem('update', [Local(() => [] as number[])], (buf) => {
      buf.current.push(buf.current.length);
      lastLen = buf.current.length;
    });

    app.advanceFrame(0);
    app.advanceFrame(16);
    app.advanceFrame(32);

    expect(lastLen).toBe(3); // the same array grew across frames
  });
});
