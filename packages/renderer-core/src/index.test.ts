import { describe, expect, it } from 'bun:test';

import type { RendererCapabilities } from './index';

describe('RendererCapabilities', () => {
  it('is a structural interface', () => {
    const caps: RendererCapabilities = {
      computeShaders: true,
      storageTextures: true,
      timestampQueries: false,
      indirectDraw: true,
      bgra8UnormStorage: false,
    };
    expect(caps.computeShaders).toBe(true);
    expect(caps.timestampQueries).toBe(false);
  });
});
