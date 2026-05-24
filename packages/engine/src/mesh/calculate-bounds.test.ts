import { describe, expect, it } from 'bun:test';

import { App } from '../index';
import { makeRenderingRenderer } from '../test-utils';
import { calculateBoundsSystem } from './calculate-bounds';
import { Mesh } from './mesh';
import { Meshes } from './meshes';
import { MeshAttribute } from './vertex-attribute';

describe('calculateBoundsSystem', () => {
  it('is a no-op in the current phase (slot reserved; body lands with Mesh3d)', () => {
    expect(() => calculateBoundsSystem()).not.toThrow();
  });

  it('the slot is anchored — the system runs without throwing on a frame with no mesh-bearing entities', () => {
    const app = new App({ renderer: makeRenderingRenderer() });
    expect(() => app.advanceFrame()).not.toThrow();
  });

  it('does not interfere with Meshes / RenderMeshes flow', () => {
    const app = new App({ renderer: makeRenderingRenderer() });
    const meshes = app.getResource(Meshes)!;
    meshes.add(
      new Mesh().insertAttribute(MeshAttribute.POSITION, new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])),
    );
    expect(() => app.advanceFrame()).not.toThrow();
  });
});
