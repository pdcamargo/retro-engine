import type { Entity } from '@retro-engine/ecs';
import type {
  ResolvedRenderTarget,
  Texture,
  TextureDescriptor,
  TextureView,
} from '@retro-engine/renderer-core';
import { describe, expect, it } from 'bun:test';

import { App } from '../index';
import { makeHeadlessRenderer } from '../test-utils';

import type { PrepassFlags } from './components';
import {
  evictCameraPrepassTargets,
  PREPASS_MOTION_VECTOR_FORMAT,
  PREPASS_NORMAL_FORMAT,
  resolveCameraPrepassTargets,
  ViewPrepassTargets,
} from './view-prepass-targets';

const e = (id: number): Entity => id as unknown as Entity;

const flags = (
  init: Partial<PrepassFlags> = {},
): PrepassFlags => ({
  depth: init.depth ?? false,
  normal: init.normal ?? false,
  motionVector: init.motionVector ?? false,
});

const stubDepth = (width: number, height: number): ResolvedRenderTarget => ({
  view: { destroy: () => undefined } as TextureView,
  format: 'depth32float',
  width,
  height,
});

const trackingApp = (): { app: App; created: TextureDescriptor[]; destroyed: number } => {
  const renderer = makeHeadlessRenderer();
  const created: TextureDescriptor[] = [];
  let destroyed = 0;
  const wrapped = {
    ...renderer,
    createTexture(descriptor: TextureDescriptor): Texture {
      created.push(descriptor);
      const view: TextureView = {
        destroy: () => {
          destroyed += 1;
        },
      };
      return {
        width: descriptor.width,
        height: descriptor.height,
        depthOrArrayLayers: descriptor.depthOrArrayLayers ?? 1,
        format: descriptor.format,
        mipLevelCount: descriptor.mipLevelCount ?? 1,
        sampleCount: descriptor.sampleCount ?? 1,
        usage: descriptor.usage,
        createView: () => view,
        destroy: () => {
          destroyed += 1;
        },
      };
    },
  };
  const app = new App({ renderer: wrapped });
  // Surface the closure's mutable counter through a getter object.
  const obj = { app, created, get destroyed() { return destroyed; } };
  return obj as unknown as { app: App; created: TextureDescriptor[]; destroyed: number };
};

describe('resolveCameraPrepassTargets', () => {
  it('depth-only allocates no color textures', () => {
    const { app, created } = trackingApp();
    const cache = new ViewPrepassTargets();
    const depth = stubDepth(160, 120);
    const view = resolveCameraPrepassTargets(cache, app, e(1), flags({ depth: true }), depth);
    expect(created.length).toBe(0);
    expect(view.normal).toBeUndefined();
    expect(view.motionVector).toBeUndefined();
    expect(view.depth).toBe(depth);
  });

  it('normal flag allocates an rgba16float color target', () => {
    const { app, created } = trackingApp();
    const cache = new ViewPrepassTargets();
    const depth = stubDepth(160, 120);
    const view = resolveCameraPrepassTargets(
      cache,
      app,
      e(2),
      flags({ depth: true, normal: true }),
      depth,
    );
    expect(created.length).toBe(1);
    expect(created[0]?.format).toBe(PREPASS_NORMAL_FORMAT);
    expect(created[0]?.width).toBe(160);
    expect(created[0]?.height).toBe(120);
    expect(view.normal?.format).toBe(PREPASS_NORMAL_FORMAT);
  });

  it('motion-vector flag allocates an rg16float color target', () => {
    const { app, created } = trackingApp();
    const cache = new ViewPrepassTargets();
    const depth = stubDepth(160, 120);
    const view = resolveCameraPrepassTargets(
      cache,
      app,
      e(3),
      flags({ depth: true, motionVector: true }),
      depth,
    );
    expect(created.length).toBe(1);
    expect(created[0]?.format).toBe(PREPASS_MOTION_VECTOR_FORMAT);
    expect(view.motionVector?.format).toBe(PREPASS_MOTION_VECTOR_FORMAT);
  });

  it('all three flags allocate both color targets', () => {
    const { app, created } = trackingApp();
    const cache = new ViewPrepassTargets();
    const depth = stubDepth(320, 240);
    const view = resolveCameraPrepassTargets(
      cache,
      app,
      e(4),
      flags({ depth: true, normal: true, motionVector: true }),
      depth,
    );
    expect(created.length).toBe(2);
    expect(view.normal).toBeDefined();
    expect(view.motionVector).toBeDefined();
  });

  it('reuses textures when called twice with identical flags + size', () => {
    const { app, created } = trackingApp();
    const cache = new ViewPrepassTargets();
    const depth1 = stubDepth(160, 120);
    resolveCameraPrepassTargets(cache, app, e(5), flags({ depth: true, normal: true }), depth1);
    expect(created.length).toBe(1);
    const depth2 = stubDepth(160, 120);
    resolveCameraPrepassTargets(cache, app, e(5), flags({ depth: true, normal: true }), depth2);
    expect(created.length).toBe(1); // no realloc
  });

  it('reallocates when camera size changes', () => {
    const obj = trackingApp() as unknown as {
      app: App;
      created: TextureDescriptor[];
      destroyed: number;
    };
    const cache = new ViewPrepassTargets();
    resolveCameraPrepassTargets(
      cache,
      obj.app,
      e(6),
      flags({ depth: true, normal: true }),
      stubDepth(160, 120),
    );
    resolveCameraPrepassTargets(
      cache,
      obj.app,
      e(6),
      flags({ depth: true, normal: true }),
      stubDepth(320, 240),
    );
    expect(obj.created.length).toBe(2);
    expect(obj.destroyed).toBeGreaterThan(0);
  });

  it('reallocates when flags change', () => {
    const { app, created } = trackingApp();
    const cache = new ViewPrepassTargets();
    resolveCameraPrepassTargets(
      cache,
      app,
      e(7),
      flags({ depth: true, normal: true }),
      stubDepth(160, 120),
    );
    resolveCameraPrepassTargets(
      cache,
      app,
      e(7),
      flags({ depth: true, normal: true, motionVector: true }),
      stubDepth(160, 120),
    );
    // Two creates for the first call (normal), then two more for the rebuild
    // (normal + motion). Total 3 creates: normal (first), normal (rebuild),
    // motion (rebuild).
    expect(created.length).toBe(3);
  });
});

describe('evictCameraPrepassTargets', () => {
  it('removes the entry and destroys textures', () => {
    const obj = trackingApp() as unknown as {
      app: App;
      created: TextureDescriptor[];
      destroyed: number;
    };
    const cache = new ViewPrepassTargets();
    resolveCameraPrepassTargets(
      cache,
      obj.app,
      e(8),
      flags({ depth: true, normal: true, motionVector: true }),
      stubDepth(160, 120),
    );
    expect(cache.perCamera.has(e(8))).toBe(true);
    evictCameraPrepassTargets(cache, e(8));
    expect(cache.perCamera.has(e(8))).toBe(false);
    expect(obj.destroyed).toBeGreaterThan(0);
  });

  it('is a no-op when no entry exists', () => {
    const { app: _app } = trackingApp();
    const cache = new ViewPrepassTargets();
    expect(() => evictCameraPrepassTargets(cache, e(99))).not.toThrow();
  });
});
