import { describe, expect, it } from 'bun:test';

import { Aabb } from '@retro-engine/math';

import { App } from '../index';
import { makeRenderingRenderer } from '../test-utils';
import { Transform } from '../transform';
import { Mesh } from './mesh';
import { Mesh3d } from './mesh-3d';
import { Meshes } from './meshes';
import { MeshAttribute } from './vertex-attribute';

describe('calculateBoundsSystem', () => {
  it('runs without throwing on a frame with no mesh-bearing entities', () => {
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

  it('writes an Aabb on Mesh3d entities derived from the mesh asset', () => {
    const app = new App({ renderer: makeRenderingRenderer() });
    const meshes = app.getResource(Meshes)!;
    const handle = meshes.add(
      // Single triangle from (-1, -2, -3) to (1, 2, 3). AABB centred at origin
      // with half-extents (1, 2, 3).
      new Mesh().insertAttribute(
        MeshAttribute.POSITION,
        new Float32Array([-1, -2, -3, 1, 2, 3, 0, 0, 0]),
      ),
    );
    const entity = app.world.spawn(new Mesh3d(handle), new Transform());
    app.advanceFrame();
    const aabb = app.world.entity(entity).get<Aabb>(Aabb);
    expect(aabb).toBeDefined();
    expect(aabb!.center[0]).toBeCloseTo(0);
    expect(aabb!.center[1]).toBeCloseTo(0);
    expect(aabb!.center[2]).toBeCloseTo(0);
    expect(aabb!.halfExtents[0]).toBeCloseTo(1);
    expect(aabb!.halfExtents[1]).toBeCloseTo(2);
    expect(aabb!.halfExtents[2]).toBeCloseTo(3);
  });

  it('is change-gated: skips an unchanged Mesh3d, refreshes on markChanged', () => {
    const app = new App({ renderer: makeRenderingRenderer() });
    const meshes = app.getResource(Meshes)!;
    const mesh = new Mesh().insertAttribute(
      MeshAttribute.POSITION,
      new Float32Array([-1, -1, -1, 1, 1, 1, 0, 0, 0]),
    );
    const handle = meshes.add(mesh);
    const entity = app.world.spawn(new Mesh3d(handle), new Transform());

    // Frame the Mesh3d is added: the entity is visited and bounds are written.
    app.advanceFrame();
    expect(app.world.entity(entity).get<Aabb>(Aabb)!.halfExtents[0]).toBeCloseTo(1);

    // Edit the mesh geometry in place under the same handle. The gate keys on
    // Mesh3d, not on the Mesh asset, so this alone must NOT refresh bounds.
    mesh.insertAttribute(
      MeshAttribute.POSITION,
      new Float32Array([-4, -4, -4, 4, 4, 4, 0, 0, 0]),
    );
    app.advanceFrame();
    expect(app.world.entity(entity).get<Aabb>(Aabb)!.halfExtents[0]).toBeCloseTo(1);

    // Signalling the change re-runs the writer for that entity.
    app.world.markChanged(entity, Mesh3d);
    app.advanceFrame();
    expect(app.world.entity(entity).get<Aabb>(Aabb)!.halfExtents[0]).toBeCloseTo(4);
  });
});
