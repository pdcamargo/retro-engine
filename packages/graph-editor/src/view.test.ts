import { describe, expect, it } from 'bun:test';

import { fitBounds } from './canvas';
import { createGraphView, screenToWorld, worldToScreen, zoomAt } from './view';

const ORIGIN: readonly [number, number] = [100, 50];

describe('view transforms', () => {
  it('round-trips world <-> screen at arbitrary pan/zoom', () => {
    const view = createGraphView({ pan: [37, -12], zoom: 1.4 });
    const s = worldToScreen(view, ORIGIN, 200, 90);
    const w = screenToWorld(view, ORIGIN, s[0], s[1]);
    expect(w[0]).toBeCloseTo(200, 6);
    expect(w[1]).toBeCloseTo(90, 6);
  });

  it('keeps the world point under the cursor fixed while zooming', () => {
    const view = createGraphView({ zoom: 1 });
    const anchor: [number, number] = [300, 220];
    const before = screenToWorld(view, ORIGIN, anchor[0], anchor[1]);
    zoomAt(view, ORIGIN, anchor, 1.1);
    const after = screenToWorld(view, ORIGIN, anchor[0], anchor[1]);
    expect(after[0]).toBeCloseTo(before[0], 4);
    expect(after[1]).toBeCloseTo(before[1], 4);
    expect(view.zoom).toBeCloseTo(1.1, 6);
  });

  it('clamps zoom to [minZoom, maxZoom]', () => {
    const view = createGraphView({ zoom: 1.9 });
    zoomAt(view, ORIGIN, [0, 0], 4); // would overshoot
    expect(view.zoom).toBe(view.maxZoom);
    zoomAt(view, ORIGIN, [0, 0], 0.001); // would undershoot
    expect(view.zoom).toBe(view.minZoom);
  });

  it('fits bounds within the region and centers them', () => {
    const view = createGraphView();
    const region: [number, number] = [800, 600];
    const bounds: [number, number, number, number] = [0, 0, 1000, 500];
    fitBounds(view, region, bounds);
    // Padded content must map inside the region on both axes.
    const tl = worldToScreen(view, [0, 0], bounds[0], bounds[1]);
    const br = worldToScreen(view, [0, 0], bounds[2], bounds[3]);
    expect(tl[0]).toBeGreaterThanOrEqual(0);
    expect(tl[1]).toBeGreaterThanOrEqual(0);
    expect(br[0]).toBeLessThanOrEqual(region[0]);
    expect(br[1]).toBeLessThanOrEqual(region[1]);
    expect(view.zoom).toBeLessThanOrEqual(1);
  });

  it('does not fit an empty document', () => {
    const view = createGraphView({ zoom: 1.3 });
    fitBounds(view, [800, 600], null);
    expect(view.zoom).toBe(1.3);
  });
});
