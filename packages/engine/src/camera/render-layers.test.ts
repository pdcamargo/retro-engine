import { describe, expect, it } from 'bun:test';

import { RenderLayers, renderLayersIntersect } from './render-layers';

describe('RenderLayers', () => {
  it('default-constructs with mask 0b1 (layer 0)', () => {
    expect(new RenderLayers().mask).toBe(0b1);
    expect(RenderLayers.DEFAULT_MASK).toBe(0b1);
  });

  it('layer(n) produces a single-bit mask', () => {
    expect(RenderLayers.layer(0).mask).toBe(0b1);
    expect(RenderLayers.layer(3).mask).toBe(0b1000);
    expect(RenderLayers.layer(31).mask >>> 0).toBe(0x80000000);
  });

  it('layers(...) ORs the supplied bits', () => {
    expect(RenderLayers.layers(0, 1).mask).toBe(0b11);
    expect(RenderLayers.layers(0, 2, 5).mask).toBe(0b100101);
  });
});

describe('renderLayersIntersect', () => {
  it('returns true for two undefined inputs (both default to layer 0)', () => {
    expect(renderLayersIntersect(undefined, undefined)).toBe(true);
  });

  it('treats undefined as the default mask when intersecting against an explicit layer', () => {
    expect(renderLayersIntersect(undefined, RenderLayers.layer(0))).toBe(true);
    expect(renderLayersIntersect(undefined, RenderLayers.layer(1))).toBe(false);
    expect(renderLayersIntersect(RenderLayers.layer(0), undefined)).toBe(true);
  });

  it('returns true iff the two explicit masks share at least one bit', () => {
    expect(renderLayersIntersect(RenderLayers.layer(0), RenderLayers.layer(1))).toBe(false);
    expect(renderLayersIntersect(RenderLayers.layers(0, 1), RenderLayers.layer(1))).toBe(true);
    expect(renderLayersIntersect(RenderLayers.layers(0, 2), RenderLayers.layers(2, 3))).toBe(true);
  });
});
