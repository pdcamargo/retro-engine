// Repro of the runtime crash reported from the browser playground:
//   TypeError: Cannot read properties of undefined (reading 'handle')
//     at calculateBoundsSystem (calculate-bounds.ts:43)
// Mimics the playground's spawn flow precisely — Commands.spawn of
// `(Mesh3d, MeshMaterial3d<UnlitMaterial>, Transform)` after the
// MaterialPlugin pipeline has been wired.

import { describe, expect, it } from 'bun:test';

import type { Sampler, TextureView } from '@retro-engine/renderer-core';
import { vec4 } from '@retro-engine/math';

import { App, Camera3d, Commands, Cuboid, Mesh3d, Meshes, Query, Transform } from '../index';
import { makeRenderingRenderer, makeStubCanvas } from '../test-utils';
import { ResMut } from '../system-param';

import { MaterialPlugin } from './material-plugin';
import { UnlitMaterial, UnlitMaterialPlugin } from './unlit-material';

const stubView: TextureView = { destroy: () => undefined };
const stubSampler: Sampler = { destroy: () => undefined };

describe('playground repro: Commands.spawn flow with MaterialPlugin', () => {
  it('advances a frame without crashing in calculateBoundsSystem', async () => {
    const app = new App({ renderer: makeRenderingRenderer(), canvas: makeStubCanvas() });
    app.addPlugin(new UnlitMaterialPlugin());
    const unlit = new MaterialPlugin(UnlitMaterial);
    app.addPlugin(unlit);

    app.addSystem(
      'startup',
      [Commands, ResMut(Meshes), ResMut(unlit.Materials)],
      (cmd, meshes, materials) => {
        const meshHandle = meshes.add(new Cuboid().mesh().build());
        const materialHandle = materials.add(
          new UnlitMaterial({
            color: vec4.create(1, 0.5, 0.25, 1),
            colorTexture: stubView,
            colorSampler: stubSampler,
          }),
        );
        const transform = new Transform();
        cmd.spawn(
          new Mesh3d(meshHandle),
          new unlit.MeshMaterial3d(materialHandle),
          transform,
        );
        cmd.spawn(...Camera3d());
      },
    );

    await app.run();
  });

  it('advances a frame with 16 entities + an extra archetype-creating component', async () => {
    class Spin {
      constructor(public readonly speed: number = 0.7) {}
    }
    const app = new App({ renderer: makeRenderingRenderer(), canvas: makeStubCanvas() });
    app.addPlugin(new UnlitMaterialPlugin());
    const unlit = new MaterialPlugin(UnlitMaterial);
    app.addPlugin(unlit);

    app.addSystem(
      'startup',
      [Commands, ResMut(Meshes), ResMut(unlit.Materials)],
      (cmd, meshes, materials) => {
        for (let i = 0; i < 16; i++) {
          const meshHandle = meshes.add(new Cuboid().mesh().build());
          const materialHandle = materials.add(
            new UnlitMaterial({
              color: vec4.create(1, 0.5, 0.25, 1),
              colorTexture: stubView,
              colorSampler: stubSampler,
            }),
          );
          const transform = new Transform();
          const components: object[] = [
            new Mesh3d(meshHandle),
            new unlit.MeshMaterial3d(materialHandle),
            transform,
          ];
          if (i % 2 === 0) components.push(new Spin());
          cmd.spawn(...components);
        }
        cmd.spawn(...Camera3d());
      },
    );

    // Also add a postUpdate system that queries Mesh3d directly to mimic
    // calculateBoundsSystem's exact shape.
    let observed = 0;
    app.addSystem('postUpdate', [Query([Mesh3d])], (q) => {
      for (const row of q.entries()) {
        const e = row[0];
        const m = row[1];
        // The crash: if `m` is undefined this throws on `.handle`.
        expect(m).toBeDefined();
        expect((m as Mesh3d).handle).toBeDefined();
        observed++;
        void e;
      }
    });

    await app.run();
    expect(observed).toBeGreaterThanOrEqual(16);
  });
});
