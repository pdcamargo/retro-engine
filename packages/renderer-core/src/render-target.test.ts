import { describe, expect, it } from 'bun:test';

import type { RenderTarget, ResolvedRenderTarget } from './render-target';
import type { Surface, Texture, TextureView } from './index';

describe('RenderTarget', () => {
  it('accepts the surface variant', () => {
    const surface = null as unknown as Surface;
    const target: RenderTarget = { kind: 'surface', surface };
    expect(target.kind).toBe('surface');
  });

  it('accepts the texture variant with an optional view descriptor', () => {
    const texture = null as unknown as Texture;
    const noDesc: RenderTarget = { kind: 'texture', texture };
    const withDesc: RenderTarget = {
      kind: 'texture',
      texture,
      viewDescriptor: { baseMipLevel: 0, mipLevelCount: 1 },
    };
    expect(noDesc.kind).toBe('texture');
    expect(withDesc.kind).toBe('texture');
  });

  it('accepts the view variant carrying its own metadata', () => {
    const view = null as unknown as TextureView;
    const target: RenderTarget = {
      kind: 'view',
      view,
      format: 'rgba8unorm',
      width: 320,
      height: 240,
    };
    expect(target.kind).toBe('view');
    if (target.kind === 'view') {
      expect(target.format).toBe('rgba8unorm');
      expect(target.width).toBe(320);
    }
  });

  it('ResolvedRenderTarget exposes view, format, and dimensions', () => {
    const view = null as unknown as TextureView;
    const resolved: ResolvedRenderTarget = {
      view,
      format: 'bgra8unorm',
      width: 800,
      height: 600,
    };
    expect(resolved.format).toBe('bgra8unorm');
    expect(resolved.width).toBe(800);
    expect(resolved.height).toBe(600);
  });
});
