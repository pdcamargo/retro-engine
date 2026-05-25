import { describe, expect, it } from 'bun:test';

import type { Sampler, TextureView } from '@retro-engine/renderer-core';
import { vec4 } from '@retro-engine/math';

import { App, Camera3d, Cuboid, Mesh3d, Meshes, ShaderPlugin } from '../index';
import { makeRenderingRenderer, makeStubCanvas } from '../test-utils';

import { MaterialPlugin } from './material-plugin';
import { UnlitMaterial, UnlitMaterialPlugin } from './unlit-material';

const stubTextureView: TextureView = { destroy: () => undefined };
const stubSampler: Sampler = { destroy: () => undefined };

describe('MaterialPlugin<UnlitMaterial>', () => {
  it('builds without throwing when added in the right order', () => {
    const app = new App({ renderer: makeRenderingRenderer(), canvas: makeStubCanvas() });
    expect(() => {
      app.addPlugin(new UnlitMaterialPlugin());
      app.addPlugin(new MaterialPlugin(UnlitMaterial));
    }).not.toThrow();
  });

  it('synthesises distinct per-type subclasses for Materials / RenderMaterials / MeshMaterial3d', () => {
    const plugin = new MaterialPlugin(UnlitMaterial);
    expect(plugin.Materials.name).toBe('Materials<UnlitMaterial>');
    expect(plugin.RenderMaterials.name).toBe('RenderMaterials<UnlitMaterial>');
    expect(plugin.MeshMaterial3d.name).toBe('MeshMaterial3d<UnlitMaterial>');
    // Two plugins for two different material types produce distinct subclasses.
    class AnotherMaterial extends UnlitMaterial {}
    const second = new MaterialPlugin(AnotherMaterial as unknown as typeof UnlitMaterial);
    expect(second.Materials).not.toBe(plugin.Materials);
    expect(second.MeshMaterial3d).not.toBe(plugin.MeshMaterial3d);
  });

  it('inserts the per-type resources at App.addPlugin time', () => {
    const app = new App({ renderer: makeRenderingRenderer(), canvas: makeStubCanvas() });
    app.addPlugin(new UnlitMaterialPlugin());
    const plugin = new MaterialPlugin(UnlitMaterial);
    app.addPlugin(plugin);
    expect(app.getResource(plugin.Materials)).toBeDefined();
    expect(app.getResource(plugin.RenderMaterials)).toBeDefined();
  });

  it('drives a frame end-to-end: spawn Mesh3d + MeshMaterial3d, advance one frame', async () => {
    const app = new App({ renderer: makeRenderingRenderer(), canvas: makeStubCanvas() });
    app.addPlugin(new UnlitMaterialPlugin());
    const plugin = new MaterialPlugin(UnlitMaterial);
    app.addPlugin(plugin);

    const meshHandle = app.getResource(Meshes)!.add(new Cuboid().mesh().build());
    const materialHandle = app.getResource(plugin.Materials)!.add(
      new UnlitMaterial({
        color: vec4.create(1, 0.4, 0.2, 1),
        colorTexture: stubTextureView,
        colorSampler: stubSampler,
      }),
    );

    app.world.spawn(new Mesh3d(meshHandle), new plugin.MeshMaterial3d(materialHandle));
    app.world.spawn(...Camera3d());

    await app.run();
    // No throws + no fails ⇒ the extract → prepare → queue → draw chain
    // executed for at least one frame with one renderable.
    // Sanity: RenderMaterials<UnlitMaterial> should have a prepared entry.
    const renderMaterials = app.getResource(plugin.RenderMaterials)!;
    expect(renderMaterials.has(materialHandle)).toBe(true);
  });

  it('throws when the same MaterialPlugin instance is added twice (resource collision)', () => {
    const app = new App({ renderer: makeRenderingRenderer(), canvas: makeStubCanvas() });
    app.addPlugin(new UnlitMaterialPlugin());
    const plugin = new MaterialPlugin(UnlitMaterial);
    app.addPlugin(plugin);
    expect(() => app.addPlugin(plugin)).toThrow();
  });

  it('UnlitMaterialPlugin is idempotent on the registry', () => {
    const app = new App({ renderer: makeRenderingRenderer(), canvas: makeStubCanvas() });
    app.addPlugin(new UnlitMaterialPlugin());
    expect(() => app.addPlugin(new UnlitMaterialPlugin())).not.toThrow();
  });
});

// Suppress unused-binding lint on the ShaderPlugin re-export — referenced
// for documentation in the test file's prose context.
void ShaderPlugin;
