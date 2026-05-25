import { describe, expect, it } from 'bun:test';

import type { DepthStencilAttachment, TextureView } from './index';

describe('DepthStencilAttachment structural shape', () => {
  it('accepts a depth-only configuration (back-compat with ADR-0026)', () => {
    const view = null as unknown as TextureView;
    const att: DepthStencilAttachment = {
      view,
      depthLoadOp: 'clear',
      depthStoreOp: 'store',
      depthClearValue: 1.0,
    };
    expect(att.depthLoadOp).toBe('clear');
    expect(att.stencilLoadOp).toBeUndefined();
  });

  it('accepts stencil load/store ops alongside the depth half', () => {
    const view = null as unknown as TextureView;
    const att: DepthStencilAttachment = {
      view,
      depthLoadOp: 'clear',
      depthStoreOp: 'store',
      depthClearValue: 1.0,
      stencilLoadOp: 'clear',
      stencilStoreOp: 'store',
      stencilClearValue: 0,
    };
    expect(att.stencilLoadOp).toBe('clear');
    expect(att.stencilStoreOp).toBe('store');
    expect(att.stencilClearValue).toBe(0);
  });

  it('accepts a read-only stencil aspect', () => {
    const view = null as unknown as TextureView;
    const att: DepthStencilAttachment = {
      view,
      depthLoadOp: 'load',
      depthStoreOp: 'store',
      depthReadOnly: false,
      stencilReadOnly: true,
    };
    expect(att.stencilReadOnly).toBe(true);
  });
});
