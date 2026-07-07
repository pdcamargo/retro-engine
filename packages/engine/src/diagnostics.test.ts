import { describe, expect, it } from 'bun:test';

import { Assets } from '@retro-engine/assets';

import { App, DiagnosticsPlugin, DiagnosticsStore, updateDiagnostics } from './index';
import { AssetStores } from './asset/asset-stores';
import { makeHeadlessRenderer } from './test-utils';

class Tag {}
class Tex {}

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

  it('records the asset count when given, and leaves it untouched when omitted', () => {
    const store = new DiagnosticsStore();
    updateDiagnostics(store, 0.016, 3, 12);
    expect(store.assetCount).toBe(12);
    // A later 3-arg call must not clobber the last known asset count.
    updateDiagnostics(store, 0.016, 3);
    expect(store.assetCount).toBe(12);
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

  it('reports the total loaded asset count from AssetStores', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    app.addPlugin(new DiagnosticsPlugin());
    const stores = new AssetStores();
    const tex = new Assets<Tex>();
    tex.add(new Tex());
    tex.add(new Tex());
    stores.register('Tex', tex as Assets<unknown>);
    app.insertResource(stores);

    app.advanceFrame(0);
    const store = app.getResource(DiagnosticsStore)!;
    expect(store.assetCount).toBe(2);

    tex.add(new Tex());
    app.advanceFrame(16);
    expect(store.assetCount).toBe(3);
  });
});
