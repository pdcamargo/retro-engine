import { describe, expect, it } from 'bun:test';

import { vec4 } from '@retro-engine/math';

import {
  App,
  Camera2d,
  EntityTransformGpuCache,
  Mesh2d,
  Meshes,
  Rectangle,
  ShaderPlugin,
  ViewPhases2d,
} from '../index';
import { makeCapturingRenderer, makeRenderingRenderer, makeStubCanvas } from '../test-utils';

import { ColorMaterial2d, ColorMaterial2dPlugin } from './color-material-2d';
import { Material2dPlugin } from './material-2d-plugin';

describe('Material2dPlugin<ColorMaterial2d>', () => {
  it('builds without throwing when added in the right order', () => {
    const app = new App({ renderer: makeRenderingRenderer(), canvas: makeStubCanvas() });
    expect(() => {
      app.addPlugin(new ColorMaterial2dPlugin());
      app.addPlugin(new Material2dPlugin(ColorMaterial2d));
    }).not.toThrow();
  });

  it('synthesises distinct per-type subclasses for Materials2d / RenderMaterials2d / MeshMaterial2d', () => {
    const plugin = new Material2dPlugin(ColorMaterial2d);
    expect(plugin.Materials2d.name).toBe('Materials2d<ColorMaterial2d>');
    expect(plugin.RenderMaterials2d.name).toBe('RenderMaterials2d<ColorMaterial2d>');
    expect(plugin.MeshMaterial2d.name).toBe('MeshMaterial2d<ColorMaterial2d>');

    class AnotherColorMaterial2d extends ColorMaterial2d {}
    Object.defineProperty(AnotherColorMaterial2d, 'name', { value: 'AnotherColorMaterial2d' });
    const second = new Material2dPlugin(AnotherColorMaterial2d);
    expect(second.Materials2d).not.toBe(plugin.Materials2d);
    expect(second.MeshMaterial2d).not.toBe(plugin.MeshMaterial2d);
  });

  it('inserts the per-type resources at App.addPlugin time', () => {
    const app = new App({ renderer: makeRenderingRenderer(), canvas: makeStubCanvas() });
    app.addPlugin(new ColorMaterial2dPlugin());
    const plugin = new Material2dPlugin(ColorMaterial2d);
    app.addPlugin(plugin);
    expect(app.getResource(plugin.Materials2d)).toBeDefined();
    expect(app.getResource(plugin.RenderMaterials2d)).toBeDefined();
    expect(app.getResource(EntityTransformGpuCache)).toBeDefined();
    expect(app.getResource(ViewPhases2d)).toBeDefined();
  });

  it('drives a frame end-to-end: spawn Mesh2d + MeshMaterial2d, emit one drawIndexed in opaque2d', async () => {
    const { renderer, log } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.addPlugin(new ColorMaterial2dPlugin());
    const plugin = new Material2dPlugin(ColorMaterial2d);
    app.addPlugin(plugin);

    const meshHandle = app
      .getResource(Meshes)!
      .add(new Rectangle({ halfSize: [32, 16] }).mesh().build());
    const materialHandle = app
      .getResource(plugin.Materials2d)!
      .add(new ColorMaterial2d({ color: vec4.create(1, 0.5, 0.2, 1) }));

    app.world.spawn(new Mesh2d(meshHandle), new plugin.MeshMaterial2d(materialHandle));
    app.world.spawn(...Camera2d());

    await app.run();

    const opaque = log.passes.find((p) => p.label?.endsWith('.opaque2d'));
    expect(opaque).toBeDefined();
    const drawIndexed = opaque!.drawCalls.filter((c) => c.kind === 'drawIndexed');
    expect(drawIndexed).toHaveLength(1);
    expect(drawIndexed[0]!.drawIndexed!.instanceCount).toBe(1);
  });

  it('throws when the same Material2dPlugin instance is added twice (resource collision)', () => {
    const app = new App({ renderer: makeRenderingRenderer(), canvas: makeStubCanvas() });
    app.addPlugin(new ColorMaterial2dPlugin());
    const plugin = new Material2dPlugin(ColorMaterial2d);
    app.addPlugin(plugin);
    expect(() => app.addPlugin(plugin)).toThrow();
  });

  it('ColorMaterial2dPlugin is idempotent on the registry', () => {
    const app = new App({ renderer: makeRenderingRenderer(), canvas: makeStubCanvas() });
    app.addPlugin(new ColorMaterial2dPlugin());
    expect(() => app.addPlugin(new ColorMaterial2dPlugin())).not.toThrow();
  });
});

// Suppress unused-binding lint on the ShaderPlugin re-export — referenced
// only in the TSDoc of the plugin's build() ordering requirements.
void ShaderPlugin;
