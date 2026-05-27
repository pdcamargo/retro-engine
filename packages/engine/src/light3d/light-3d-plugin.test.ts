import { describe, expect, it } from 'bun:test';

import { vec4 } from '@retro-engine/math';
import type { PipelineLayout, PipelineLayoutDescriptor, Renderer } from '@retro-engine/renderer-core';

import { App, Camera3d, Cuboid, Mesh3d, Meshes } from '../index';
import { MaterialPlugin } from '../material/material-plugin';
import { StandardMaterial, StandardMaterialPlugin } from '../material/standard-material';
import { UnlitMaterial, UnlitMaterialPlugin } from '../material/unlit-material';
import { ShaderRegistry } from '../shader/shader-registry';
import { makeCapturingRenderer, makeRenderingRenderer, makeStubCanvas } from '../test-utils';
import type { CapturedPass } from '../test-utils';

import { AmbientLight } from './ambient-light';
import { GpuLights } from './gpu-lights';
import { Light3dPlugin } from './light-3d-plugin';

// Records the bind-group-layout count of each material pipeline layout the
// MaterialPlugin builds, keyed by descriptor label.
const spyPipelineLayouts = (renderer: Renderer): Map<string, number> => {
  const sizes = new Map<string, number>();
  const original = renderer.createPipelineLayout.bind(renderer);
  renderer.createPipelineLayout = (descriptor: PipelineLayoutDescriptor): PipelineLayout => {
    if (descriptor.label !== undefined) sizes.set(descriptor.label, descriptor.bindGroupLayouts.length);
    return original(descriptor);
  };
  return sizes;
};

const opaquePass = (passes: readonly CapturedPass[]): CapturedPass => {
  const pass = passes.find((p) => p.label?.endsWith('.opaque3d'));
  expect(pass).toBeDefined();
  return pass!;
};

describe('Light3dPlugin', () => {
  it('inserts GpuLights + AmbientLight and registers retro_engine::light3d', () => {
    const app = new App({ renderer: makeRenderingRenderer(), canvas: makeStubCanvas() });
    app.addPlugin(new Light3dPlugin());
    expect(app.getResource(GpuLights)).toBeDefined();
    expect(app.getResource(AmbientLight)).toBeDefined();
    expect(app.getResource(ShaderRegistry)!.has('retro_engine::light3d')).toBe(true);
  });

  it('is unique — adding it twice throws', () => {
    const app = new App({ renderer: makeRenderingRenderer(), canvas: makeStubCanvas() });
    app.addPlugin(new Light3dPlugin());
    expect(() => app.addPlugin(new Light3dPlugin())).toThrow(/unique/);
  });

  it('builds a 3-group [view, material, lights] pipeline layout for a lit material', async () => {
    const renderer = makeRenderingRenderer();
    const layoutSizes = spyPipelineLayouts(renderer);
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.addPlugin(new StandardMaterialPlugin());
    const plugin = new MaterialPlugin(StandardMaterial);
    app.addPlugin(plugin);
    app.addPlugin(new Light3dPlugin());

    const mesh = app.getResource(Meshes)!.add(new Cuboid().mesh().build());
    const material = app.getResource(plugin.Materials)!.add(new StandardMaterial({ baseColor: vec4.create(1, 1, 1, 1) }));
    app.world.spawn(new Mesh3d(mesh), new plugin.MeshMaterial3d(material));
    app.world.spawn(...Camera3d());

    await app.run();
    expect(layoutSizes.get('material#StandardMaterial')).toBe(3);
  });

  it('leaves an unlit material at a 2-group [view, material] layout', async () => {
    const renderer = makeRenderingRenderer();
    const layoutSizes = spyPipelineLayouts(renderer);
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.addPlugin(new UnlitMaterialPlugin());
    const plugin = new MaterialPlugin(UnlitMaterial);
    app.addPlugin(plugin);
    // Light3dPlugin present, but UnlitMaterial does not opt into lights.
    app.addPlugin(new Light3dPlugin());

    const mesh = app.getResource(Meshes)!.add(new Cuboid().mesh().build());
    const material = app.getResource(plugin.Materials)!.add(new UnlitMaterial({ color: vec4.create(1, 1, 1, 1) }));
    app.world.spawn(new Mesh3d(mesh), new plugin.MeshMaterial3d(material));
    app.world.spawn(...Camera3d());

    await app.run();
    expect(layoutSizes.get('material#UnlitMaterial')).toBe(2);
  });

  it('binds the lights group at @group(2) in the opaque pass when lights are present', async () => {
    const { renderer, log } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.addPlugin(new StandardMaterialPlugin());
    const plugin = new MaterialPlugin(StandardMaterial);
    app.addPlugin(plugin);
    app.addPlugin(new Light3dPlugin());

    const mesh = app.getResource(Meshes)!.add(new Cuboid().mesh().build());
    const material = app.getResource(plugin.Materials)!.add(new StandardMaterial());
    app.world.spawn(new Mesh3d(mesh), new plugin.MeshMaterial3d(material));
    app.world.spawn(...Camera3d());

    await app.run();

    const boundGroups = opaquePass(log.passes)
      .drawCalls.filter((c) => c.kind === 'setBindGroup')
      .map((c) => c.bindGroup!.index);
    expect(boundGroups).toContain(0); // view
    expect(boundGroups).toContain(1); // material
    expect(boundGroups).toContain(2); // lights
  });

  it('throws if a lit material is used without a Light3dPlugin', async () => {
    const app = new App({ renderer: makeRenderingRenderer(), canvas: makeStubCanvas() });
    app.addPlugin(new StandardMaterialPlugin());
    const plugin = new MaterialPlugin(StandardMaterial);
    app.addPlugin(plugin);
    // No Light3dPlugin → no GpuLights layout to append, and no light3d WGSL.

    const mesh = app.getResource(Meshes)!.add(new Cuboid().mesh().build());
    const material = app.getResource(plugin.Materials)!.add(new StandardMaterial());
    app.world.spawn(new Mesh3d(mesh), new plugin.MeshMaterial3d(material));
    app.world.spawn(...Camera3d());

    expect(app.run()).rejects.toThrow();
  });
});
