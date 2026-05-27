// Repro of the runtime crash reported from the browser playground:
//   TypeError: Cannot read properties of undefined (reading 'handle')
//     at calculateBoundsSystem (calculate-bounds.ts:43)
// Mimics the playground's spawn flow precisely — Commands.spawn of
// `(Mesh3d, MeshMaterial3d<UnlitMaterial>, Transform)` after the
// MaterialPlugin pipeline has been wired.

import { describe, expect, it } from 'bun:test';

import { vec4 } from '@retro-engine/math';

import { App, Camera3d, Commands, Cuboid, Mesh3d, Meshes, Query, Transform } from '../index';
import { Light3dPlugin } from '../light3d/light-3d-plugin';
import { makeRenderingRenderer, makeStubCanvas } from '../test-utils';
import { ResMut } from '../system-param';

import { MaterialPlugin } from './material-plugin';
import { StandardMaterial, StandardMaterialPlugin } from './standard-material';
import { UnlitMaterial, UnlitMaterialPlugin } from './unlit-material';

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
          new UnlitMaterial({ color: vec4.create(1, 0.5, 0.25, 1) }),
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
            new UnlitMaterial({ color: vec4.create(1, 0.5, 0.25, 1) }),
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

  it('default-fallback path: PBR with only baseColor renders via Images.WHITE / NORMAL_FLAT', async () => {
    // Phase 7.5 — the canonical "the schema resolves missing textures through
    // the seeded default Images" check. No texture fields set on the material
    // (`baseColorTexture`, `metallicRoughnessTexture`, `normalMapTexture`,
    // `emissiveTexture`, `occlusionTexture` are all undefined). The five
    // texture bindings + the shared sampler binding all resolve through
    // `Images.WHITE` (or `Images.NORMAL_FLAT` for the normal map slot) via
    // the schema's per-entry `fallback` discriminant.
    const app = new App({ renderer: makeRenderingRenderer(), canvas: makeStubCanvas() });
    app.addPlugin(new StandardMaterialPlugin());
    const plugin = new MaterialPlugin(StandardMaterial);
    app.addPlugin(plugin);
    // StandardMaterial is lit: it #imports retro_engine::light3d and binds the
    // GpuLights group at @group(2), so it requires a Light3dPlugin.
    app.addPlugin(new Light3dPlugin());

    app.addSystem(
      'startup',
      [Commands, ResMut(Meshes), ResMut(plugin.Materials)],
      (cmd, meshes, materials) => {
        const meshHandle = meshes.add(new Cuboid().mesh().build());
        const materialHandle = materials.add(
          new StandardMaterial({ baseColor: vec4.create(1, 0.5, 0.25, 1) }),
        );
        cmd.spawn(
          new Mesh3d(meshHandle),
          new plugin.MeshMaterial3d(materialHandle),
          new Transform(),
        );
        cmd.spawn(...Camera3d());
      },
    );

    await app.run();
    const renderMaterials = app.getResource(plugin.RenderMaterials)!;
    // One material registered → one prepared entry in RenderMaterials. If the
    // walker's fallback path were broken, the prepare system would throw and
    // the entry would be missing.
    expect(renderMaterials.size).toBe(1);
  });
});
