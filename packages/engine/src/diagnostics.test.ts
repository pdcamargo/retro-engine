import { describe, expect, it } from 'bun:test';

import { App, DiagnosticsPlugin, DiagnosticsStore, updateDiagnostics } from './index';
import { makeHeadlessRenderer } from './test-utils';

class Tag {}

describe('updateDiagnostics', () => {
  it('smooths frame time toward the sample and derives fps', () => {
    const store = new DiagnosticsStore();
    for (let i = 0; i < 300; i++) updateDiagnostics(store, 0.016, 3);
    expect(store.frameTimeMs).toBeCloseTo(16, 1);
    expect(store.fps).toBeCloseTo(1000 / 16, 0);
    expect(store.entityCount).toBe(3);
    expect(store.frameCount).toBe(300);
  });

  it('seeds the frame time from the first real sample (no cold-start ramp from 0)', () => {
    const store = new DiagnosticsStore();
    updateDiagnostics(store, 0.02, 1);
    expect(store.frameTimeMs).toBeCloseTo(20, 5); // first sample sets it directly
  });

  it('counts a zero-delta frame but leaves timing untouched', () => {
    const store = new DiagnosticsStore();
    updateDiagnostics(store, 0, 5);
    expect(store.frameCount).toBe(1);
    expect(store.entityCount).toBe(5);
    expect(store.frameTimeMs).toBe(0);
    expect(store.fps).toBe(0);
  });
});

describe('DiagnosticsPlugin (integration)', () => {
  it('updates the store each frame from the real clock + live entity count', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    app.addPlugin(new DiagnosticsPlugin());
    app.world.spawn(new Tag());
    app.world.spawn(new Tag());
    const baseline = app.world.entityCount;

    app.advanceFrame(0);
    app.advanceFrame(16);
    app.advanceFrame(32);

    const store = app.getResource(DiagnosticsStore)!;
    expect(store.frameCount).toBe(3);
    expect(store.entityCount).toBe(baseline);
    expect(store.frameTimeMs).toBeGreaterThan(0);
    expect(store.fps).toBeGreaterThan(0);

    app.world.spawn(new Tag());
    app.advanceFrame(48);
    expect(store.entityCount).toBe(baseline + 1);
  });
});
