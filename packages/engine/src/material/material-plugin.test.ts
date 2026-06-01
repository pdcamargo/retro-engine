import { describe, expect, it } from 'bun:test';

import { vec4 } from '@retro-engine/math';
import type {
  RenderPipeline,
  RenderPipelineDescriptor,
  Renderer,
} from '@retro-engine/renderer-core';

import { App, Camera3d, Cuboid, Mesh3d, Meshes, ShaderPlugin } from '../index';
import { Light3dPlugin } from '../light3d/light-3d-plugin';
import { DepthPrepass, MotionVectorPrepass, NormalPrepass } from '../prepass/components';
import { PrepassPlugin } from '../prepass/prepass-plugin';
import { makeRenderingRenderer, makeStubCanvas } from '../test-utils';

import { MaterialPlugin } from './material-plugin';
import { StandardMaterial, StandardMaterialPlugin } from './standard-material';
import { UnlitMaterial, UnlitMaterialPlugin } from './unlit-material';

/**
 * Wraps a rendering stub renderer, recording every {@link RenderPipelineDescriptor}
 * handed to `createRenderPipeline`. Lets a test assert invariants on the
 * pipeline descriptors the material plugin builds — the stub itself validates
 * nothing, so these are the only place to catch device-fatal descriptor shapes
 * (empty fragment targets, out-of-range vertex locations) without a GPU.
 */
const makeDescriptorCapturingRenderer = (): {
  renderer: Renderer;
  descriptors: RenderPipelineDescriptor[];
} => {
  const base = makeRenderingRenderer();
  const descriptors: RenderPipelineDescriptor[] = [];
  const create = base.createRenderPipeline.bind(base);
  base.createRenderPipeline = (descriptor: RenderPipelineDescriptor): RenderPipeline => {
    descriptors.push(descriptor);
    return create(descriptor);
  };
  return { renderer: base, descriptors };
};

const prepassDescriptors = (descriptors: RenderPipelineDescriptor[]): RenderPipelineDescriptor[] =>
  descriptors.filter((d) => typeof d.label === 'string' && d.label.includes('#prepass#'));

const requestsColorChannel = (label: string): boolean =>
  // The prepass descriptor label encodes active flags as a `d`/`n`/`m` suffix
  // after `#prepass#`. A normal or motion request means a color target is owed.
  /#prepass#[dnm]*[nm]/.test(label);

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
    // No colorTexture — the schema's `fallback: 'white'` resolves binding 1
    // and binding 2 through `Images.WHITE`.
    const materialHandle = app.getResource(plugin.Materials)!.add(
      new UnlitMaterial({ color: vec4.create(1, 0.4, 0.2, 1) }),
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

const buildPrepassApp = (renderer: Renderer, materialClass: typeof StandardMaterial) => {
  const app = new App({ renderer, canvas: makeStubCanvas() });
  app.addPlugin(new StandardMaterialPlugin());
  const matPlugin = new MaterialPlugin(materialClass);
  app.addPlugin(matPlugin);
  app.addPlugin(new Light3dPlugin());
  app.addPlugin(new PrepassPlugin());
  return { app, matPlugin };
};

describe('MaterialPlugin — prepass fragment-target invariants', () => {
  it('never builds a normal/motion prepass pipeline with empty fragment targets', async () => {
    const { renderer, descriptors } = makeDescriptorCapturingRenderer();
    const { app, matPlugin } = buildPrepassApp(renderer, StandardMaterial);
    const meshHandle = app.getResource(Meshes)!.add(new Cuboid().mesh().build());
    const matHandle = app
      .getResource(matPlugin.Materials)!
      .add(new StandardMaterial({ baseColor: vec4.create(1, 1, 1, 1) }));
    app.world.spawn(new Mesh3d(meshHandle), new matPlugin.MeshMaterial3d(matHandle));
    app.world.spawn(...Camera3d(), new DepthPrepass(), new NormalPrepass(), new MotionVectorPrepass());

    await app.run();
    app.stop();

    const colorPrepass = prepassDescriptors(descriptors).filter((d) =>
      requestsColorChannel(d.label as string),
    );
    // The combined normal + motion variant must have been built and must carry
    // at least one color target — the exact failure mode the minification bug
    // produced (empty targets → rejected pipeline).
    expect(colorPrepass.length).toBeGreaterThan(0);
    for (const d of colorPrepass) {
      expect(d.fragment).toBeDefined();
      expect(d.fragment!.targets.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('gates prepass color output on prepassWrites(), not the (minifiable) class name', async () => {
    // Simulate a production bundle renaming the class to a single letter. The
    // capability gate must still attach the motion/normal targets because it
    // reads the material's declared `prepassWrites()`, not `class.name`.
    class Minified extends StandardMaterial {}
    Object.defineProperty(Minified, 'name', { value: 'a' });

    const { renderer, descriptors } = makeDescriptorCapturingRenderer();
    const { app, matPlugin } = buildPrepassApp(renderer, Minified);
    const meshHandle = app.getResource(Meshes)!.add(new Cuboid().mesh().build());
    const matHandle = app
      .getResource(matPlugin.Materials)!
      .add(new Minified({ baseColor: vec4.create(1, 1, 1, 1) }));
    app.world.spawn(new Mesh3d(meshHandle), new matPlugin.MeshMaterial3d(matHandle));
    app.world.spawn(...Camera3d(), new DepthPrepass(), new NormalPrepass(), new MotionVectorPrepass());

    await app.run();
    app.stop();

    const colorPrepass = prepassDescriptors(descriptors).filter((d) =>
      requestsColorChannel(d.label as string),
    );
    expect(colorPrepass.length).toBeGreaterThan(0);
    for (const d of colorPrepass) {
      expect(d.fragment).toBeDefined();
      expect(d.fragment!.targets.length).toBeGreaterThanOrEqual(1);
    }
  });
});

const buildStandardApp = (renderer: Renderer) => {
  const app = new App({ renderer, canvas: makeStubCanvas() });
  app.addPlugin(new StandardMaterialPlugin());
  const matPlugin = new MaterialPlugin(StandardMaterial);
  app.addPlugin(matPlugin);
  app.addPlugin(new Light3dPlugin());
  return { app, matPlugin };
};

// Shading (non-prepass) pipeline descriptors for the material — the place the
// per-material cull mode is selected.
const shadingDescriptors = (descriptors: RenderPipelineDescriptor[]): RenderPipelineDescriptor[] =>
  descriptors.filter(
    (d) =>
      typeof d.label === 'string' && d.label.includes('StandardMaterial') && !d.label.includes('#prepass#'),
  );

describe('MaterialPlugin — per-material cull mode (doubleSided)', () => {
  it('culls back faces for a single-sided material (default)', async () => {
    const { renderer, descriptors } = makeDescriptorCapturingRenderer();
    const { app, matPlugin } = buildStandardApp(renderer);
    const meshHandle = app.getResource(Meshes)!.add(new Cuboid().mesh().build());
    const matHandle = app
      .getResource(matPlugin.Materials)!
      .add(new StandardMaterial({ baseColor: vec4.create(1, 1, 1, 1) }));
    app.world.spawn(new Mesh3d(meshHandle), new matPlugin.MeshMaterial3d(matHandle));
    app.world.spawn(...Camera3d());

    await app.run();
    app.stop();

    const shading = shadingDescriptors(descriptors);
    expect(shading.length).toBeGreaterThan(0);
    for (const d of shading) expect(d.primitive?.cullMode).toBe('back');
  });

  it('disables culling for a double-sided material', async () => {
    const { renderer, descriptors } = makeDescriptorCapturingRenderer();
    const { app, matPlugin } = buildStandardApp(renderer);
    const meshHandle = app.getResource(Meshes)!.add(new Cuboid().mesh().build());
    const matHandle = app
      .getResource(matPlugin.Materials)!
      .add(new StandardMaterial({ baseColor: vec4.create(1, 1, 1, 1), doubleSided: true }));
    app.world.spawn(new Mesh3d(meshHandle), new matPlugin.MeshMaterial3d(matHandle));
    app.world.spawn(...Camera3d());

    await app.run();
    app.stop();

    const shading = shadingDescriptors(descriptors);
    expect(shading.length).toBeGreaterThan(0);
    for (const d of shading) expect(d.primitive?.cullMode).toBe('none');
  });
});

// Suppress unused-binding lint on the ShaderPlugin re-export — referenced
// for documentation in the test file's prose context.
void ShaderPlugin;
