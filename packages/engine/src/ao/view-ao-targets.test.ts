import type { Entity } from '@retro-engine/ecs';
import type {
  Buffer,
  BufferDescriptor,
  ResolvedRenderTarget,
  Texture,
  TextureDescriptor,
  TextureView,
} from '@retro-engine/renderer-core';
import { TextureUsage } from '@retro-engine/renderer-core';
import { describe, expect, it } from 'bun:test';

import { App } from '../index';
import { makeHeadlessRenderer } from '../test-utils';

import {
  AO_TARGET_FORMAT,
  evictAoTargets,
  resolveAoTargets,
  ViewAoTargets,
} from './view-ao-targets';

const e = (id: number): Entity => id as unknown as Entity;

const stubColor = (width: number, height: number): ResolvedRenderTarget => ({
  view: { destroy: () => undefined } as TextureView,
  format: 'rgba16float',
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

describe('resolveAoTargets', () => {
  it('allocates raw + blurred r8unorm targets and one params buffer', () => {
    const t = trackingApp();
    const cache = new ViewAoTargets();
    const entry = resolveAoTargets(cache, t.app, e(1), stubColor(160, 120), false);
    expect(t.created.length).toBe(2);
    expect(t.created.every((d) => d.format === AO_TARGET_FORMAT)).toBe(true);
    expect(t.buffers).toBe(1);
    // The opaque pass samples the denoised (blurred) output.
    expect(entry.finalView).toBe(entry.blurredView);
    expect(entry.rawView).not.toBe(entry.blurredView);
  });

  it('requests RENDER_ATTACHMENT | TEXTURE_BINDING usage (sampleable by the opaque pass)', () => {
    const t = trackingApp();
    const cache = new ViewAoTargets();
    resolveAoTargets(cache, t.app, e(1), stubColor(64, 64), false);
    const usage = t.created[0]!.usage;
    expect(usage & TextureUsage.RENDER_ATTACHMENT).toBe(TextureUsage.RENDER_ATTACHMENT);
    expect(usage & TextureUsage.TEXTURE_BINDING).toBe(TextureUsage.TEXTURE_BINDING);
  });

  it('reuses texture + buffer on a same-size hit', () => {
    const t = trackingApp();
    const cache = new ViewAoTargets();
    resolveAoTargets(cache, t.app, e(2), stubColor(160, 120), false);
    resolveAoTargets(cache, t.app, e(2), stubColor(160, 120), false);
    expect(t.created.length).toBe(2);
    expect(t.buffers).toBe(1);
  });

  it('reallocates the textures on resize but keeps the params buffer', () => {
    const t = trackingApp();
    const cache = new ViewAoTargets();
    resolveAoTargets(cache, t.app, e(3), stubColor(160, 120), false);
    const second = resolveAoTargets(cache, t.app, e(3), stubColor(320, 240), false);
    expect(t.created.length).toBe(4);
    expect(t.buffers).toBe(1);
    expect(t.destroyed).toBeGreaterThanOrEqual(1);
    expect(second.width).toBe(320);
  });

  it('allocates the history ping-pong only when temporal is requested', () => {
    const t = trackingApp();
    const cache = new ViewAoTargets();
    const off = resolveAoTargets(cache, t.app, e(7), stubColor(64, 64), false);
    expect(off.historyTextures).toBeUndefined();
    expect(t.created.length).toBe(2);

    const on = resolveAoTargets(cache, t.app, e(7), stubColor(64, 64), true);
    expect(on.historyTextures).toBeDefined();
    expect(on.historyValid).toBe(false);
    expect(t.created.length).toBe(4);

    const back = resolveAoTargets(cache, t.app, e(7), stubColor(64, 64), false);
    expect(back.historyTextures).toBeUndefined();
    expect(back.finalView).toBe(back.blurredView);
  });
});

describe('evictAoTargets', () => {
  it('destroys the texture + buffer and removes the entry', () => {
    const t = trackingApp();
    const cache = new ViewAoTargets();
    resolveAoTargets(cache, t.app, e(5), stubColor(160, 120), false);
    expect(cache.perCamera.has(e(5))).toBe(true);
    evictAoTargets(cache, e(5));
    expect(cache.perCamera.has(e(5))).toBe(false);
    expect(t.destroyed).toBeGreaterThanOrEqual(2);
  });

  it('is a no-op when no entry exists', () => {
    const cache = new ViewAoTargets();
    expect(() => evictAoTargets(cache, e(99))).not.toThrow();
  });
});
