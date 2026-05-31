import type { Entity } from '@retro-engine/ecs';
import type {
  Buffer,
  BufferDescriptor,
  ResolvedRenderTarget,
  Texture,
  TextureDescriptor,
  TextureView,
} from '@retro-engine/renderer-core';
import { describe, expect, it } from 'bun:test';

import { App } from '../index';
import { makeHeadlessRenderer } from '../test-utils';

import {
  evictTaaTargets,
  resolveTaaTargets,
  TAA_TARGET_FORMAT,
  ViewTaaTargets,
} from './view-taa-targets';

const e = (id: number): Entity => id as unknown as Entity;

const stubColor = (width: number, height: number): ResolvedRenderTarget => ({
  view: { destroy: () => undefined } as TextureView,
  format: TAA_TARGET_FORMAT,
  width,
  height,
});

interface TrackingApp {
  app: App;
  created: TextureDescriptor[];
  buffers: number;
  destroyed: number;
}

const trackingApp = (): TrackingApp => {
  const renderer = makeHeadlessRenderer();
  const created: TextureDescriptor[] = [];
  let buffers = 0;
  let destroyed = 0;
  const wrapped = {
    ...renderer,
    createTexture(descriptor: TextureDescriptor): Texture {
      created.push(descriptor);
      const view: TextureView = { destroy: () => { destroyed += 1; } };
      return {
        width: descriptor.width,
        height: descriptor.height,
        depthOrArrayLayers: descriptor.depthOrArrayLayers ?? 1,
        format: descriptor.format,
        mipLevelCount: descriptor.mipLevelCount ?? 1,
        sampleCount: descriptor.sampleCount ?? 1,
        usage: descriptor.usage,
        createView: () => view,
        destroy: () => { destroyed += 1; },
      };
    },
    createBuffer(descriptor: BufferDescriptor): Buffer {
      buffers += 1;
      return {
        size: descriptor.size,
        usage: descriptor.usage,
        destroy: () => { destroyed += 1; },
      } as unknown as Buffer;
    },
  };
  const app = new App({ renderer: wrapped });
  return {
    app,
    created,
    get buffers() { return buffers; },
    get destroyed() { return destroyed; },
  } as unknown as TrackingApp;
};

describe('resolveTaaTargets', () => {
  it('allocates two ping-pong textures and one params buffer, starting invalid', () => {
    const t = trackingApp();
    const cache = new ViewTaaTargets();
    const entry = resolveTaaTargets(cache, t.app, e(1), stubColor(160, 120));
    expect(t.created.length).toBe(2);
    expect(t.created.every((d) => d.format === TAA_TARGET_FORMAT)).toBe(true);
    expect(t.buffers).toBe(1);
    expect(entry.current).toBe(0);
    expect(entry.valid).toBe(false);
    expect(entry.views[0]).not.toBe(entry.views[1]);
  });

  it('reuses textures + buffer on a same-size hit', () => {
    const t = trackingApp();
    const cache = new ViewTaaTargets();
    resolveTaaTargets(cache, t.app, e(2), stubColor(160, 120));
    resolveTaaTargets(cache, t.app, e(2), stubColor(160, 120));
    expect(t.created.length).toBe(2); // no realloc
    expect(t.buffers).toBe(1);
  });

  it('reallocates both textures on resize but keeps the params buffer, re-priming history', () => {
    const t = trackingApp();
    const cache = new ViewTaaTargets();
    const first = resolveTaaTargets(cache, t.app, e(3), stubColor(160, 120));
    first.valid = true; // pretend a frame resolved
    const second = resolveTaaTargets(cache, t.app, e(3), stubColor(320, 240));
    expect(t.created.length).toBe(4); // 2 + 2
    expect(t.buffers).toBe(1); // params buffer reused
    expect(t.destroyed).toBeGreaterThanOrEqual(2); // old views/textures freed
    expect(second.valid).toBe(false); // history invalidated by the resize
    expect(second.width).toBe(320);
  });
});

describe('TAA ping-pong semantics', () => {
  it('alternates the write slot across frames once flipped each frame', () => {
    const t = trackingApp();
    const cache = new ViewTaaTargets();
    const entry = resolveTaaTargets(cache, t.app, e(4), stubColor(64, 64));
    // Mirror the prepare system's per-frame flip.
    const flip = () => { entry.current = (entry.current ^ 1) as 0 | 1; };
    flip();
    expect(entry.current).toBe(1);
    const historyOf = () => entry.views[entry.current ^ 1];
    const writeOf = () => entry.views[entry.current];
    // Frame 1: write slot 1, history is slot 0.
    expect(writeOf()).toBe(entry.views[1]);
    expect(historyOf()).toBe(entry.views[0]);
    flip();
    // Frame 2: write slot 0, history is slot 1 (frame 1's output).
    expect(writeOf()).toBe(entry.views[0]);
    expect(historyOf()).toBe(entry.views[1]);
  });
});

describe('evictTaaTargets', () => {
  it('destroys textures + buffer and removes the entry', () => {
    const t = trackingApp();
    const cache = new ViewTaaTargets();
    resolveTaaTargets(cache, t.app, e(5), stubColor(160, 120));
    expect(cache.perCamera.has(e(5))).toBe(true);
    evictTaaTargets(cache, e(5));
    expect(cache.perCamera.has(e(5))).toBe(false);
    expect(t.destroyed).toBeGreaterThanOrEqual(3); // 2 textures + 1 buffer (+ views)
  });

  it('is a no-op when no entry exists', () => {
    const cache = new ViewTaaTargets();
    expect(() => evictTaaTargets(cache, e(99))).not.toThrow();
  });
});
