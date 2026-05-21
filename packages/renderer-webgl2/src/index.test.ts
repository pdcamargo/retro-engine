import { describe, expect, it } from 'bun:test';

import { createWebGL2Renderer } from './index';

describe('createWebGL2Renderer (stub)', () => {
  it('reports no optional capabilities', () => {
    const canvas = {} as HTMLCanvasElement;
    const renderer = createWebGL2Renderer(canvas);
    expect(renderer.capabilities.computeShaders).toBe(false);
    expect(renderer.capabilities.indirectDraw).toBe(false);
  });

  it('init() rejects with a not-implemented error', async () => {
    const canvas = {} as HTMLCanvasElement;
    const renderer = createWebGL2Renderer(canvas);
    await expect(renderer.init()).rejects.toThrow(/not implemented/i);
  });
});
