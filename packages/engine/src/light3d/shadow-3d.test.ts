import { describe, expect, it } from 'bun:test';

import { vec3 } from '@retro-engine/math';
import type { Renderer } from '@retro-engine/renderer-core';

import {
  App,
  Camera3d,
  CascadeShadowConfig,
  Core3dLabel,
  Cuboid,
  DirectionalLight3d,
  GpuLights,
  Light3dPlugin,
  MAX_SHADOW_CASTERS,
  MaterialPlugin,
  Mesh3d,
  Meshes,
  OpaquePass3dLabel,
  PointLight3d,
  RenderGraph,
  Shadow3dPass3dLabel,
  Shadow3dSettings,
  Shadow3dState,
  ShadowFilteringMethod,
  SpotLight3d,
  StandardMaterial,
  StandardMaterialPlugin,
  Transform,
} from '../index';
import { makeCapturingRenderer, makeRenderingRenderer, makeStubCanvas } from '../test-utils';

const litApp = (renderer: Renderer) => {
  const app = new App({ renderer, canvas: makeStubCanvas() });
  app.addPlugin(new StandardMaterialPlugin());
  const plugin = new MaterialPlugin(StandardMaterial);
  app.addPlugin(plugin);
  app.addPlugin(new Light3dPlugin());
  const mesh = app.getResource(Meshes)!.add(new Cuboid().mesh().build());
  const material = app.getResource(plugin.Materials)!.add(new StandardMaterial());
  // Origin sits inside the default Camera3d frustum (frustum culling would hide
  // an off-screen caster), which is all these collection tests need.
  const spawnMesh = (...extra: object[]) =>
    app.world.spawn(new Mesh3d(mesh), new plugin.MeshMaterial3d(material), new Transform(), ...extra);
  return { app, spawnMesh };
};

describe('Shadow3dState (unit)', () => {
  it('ensure() returns false (allocating nothing) before the GpuLights layout exists', () => {
    const app = new App({ renderer: makeRenderingRenderer(), canvas: makeStubCanvas() });
    const shadow = new Shadow3dState();
    expect(shadow.ensure(app, new GpuLights())).toBe(false);
    expect(shadow.atlasTexture).toBeUndefined();
  });
});

describe('Light3dPlugin shadows (integration)', () => {
  it('bootstraps the atlas + comparison sampler and builds the lights bind group', async () => {
    const { renderer } = makeCapturingRenderer();
    const { app, spawnMesh } = litApp(renderer);
    spawnMesh();
    // One cascade keeps this focused on bootstrap (one directional → one layer).
    app.world.spawn(
      new DirectionalLight3d({ intensity: 2 }),
      new CascadeShadowConfig({ numCascades: 1 }),
      new Transform(),
    );
    app.world.spawn(...Camera3d());
    await app.run();

    const shadow = app.getResource(Shadow3dState)!;
    expect(shadow.atlasTexture).toBeDefined();
    expect(shadow.atlasArrayView).toBeDefined();
    expect(shadow.comparisonSampler).toBeDefined();
    expect(shadow.layerViews.length).toBe(MAX_SHADOW_CASTERS);
    expect(shadow.shadowLightCount).toBe(1);
    expect(shadow.casterBatches.length).toBeGreaterThanOrEqual(1);
    expect(app.getResource(GpuLights)!.bindGroup).toBeDefined();
  });

  it('orders the shadow pass before the opaque pass in the Core3d sub-graph', async () => {
    const { renderer } = makeCapturingRenderer();
    const { app, spawnMesh } = litApp(renderer);
    spawnMesh();
    app.world.spawn(new DirectionalLight3d(), new Transform());
    app.world.spawn(...Camera3d());
    await app.run();

    const ordered = app
      .getResource(RenderGraph)!
      .getSubGraph(Core3dLabel)!
      .orderedNodes()!
      .map((n) => String(n.label));
    const shadowIdx = ordered.indexOf(String(Shadow3dPass3dLabel));
    const opaqueIdx = ordered.indexOf(String(OpaquePass3dLabel));
    expect(shadowIdx).toBeGreaterThanOrEqual(0);
    expect(shadowIdx).toBeLessThan(opaqueIdx);
  });

  it('renders a depth-only pass per shadow-casting light when a caster is present', async () => {
    const { renderer, log } = makeCapturingRenderer();
    const { app, spawnMesh } = litApp(renderer);
    spawnMesh();
    app.world.spawn(new DirectionalLight3d(), new Transform());
    app.world.spawn(...Camera3d());
    await app.run();

    const layerPass = log.passes.find((p) => p.label === 'shadow3d_atlas_layer#0');
    expect(layerPass).toBeDefined();
    const draws = layerPass!.drawCalls.filter((c) => c.kind === 'draw' || c.kind === 'drawIndexed');
    expect(draws.length).toBeGreaterThanOrEqual(1);
  });

  it('skips the shadow pass when no light casts a shadow (point light only)', async () => {
    const { renderer, log } = makeCapturingRenderer();
    const { app, spawnMesh } = litApp(renderer);
    spawnMesh();
    // Point lights do not cast shadows in this stage.
    app.world.spawn(new PointLight3d({ range: 20 }), new Transform(vec3.create(0, 5, 0)));
    app.world.spawn(...Camera3d());
    await app.run();

    expect(app.getResource(Shadow3dState)!.shadowLightCount).toBe(0);
    expect(log.passes.find((p) => p.label?.startsWith('shadow3d_atlas_layer'))).toBeUndefined();
  });

  it('assigns directional then spot lights to atlas layers in order', async () => {
    const { renderer } = makeCapturingRenderer();
    const { app, spawnMesh } = litApp(renderer);
    spawnMesh();
    // One cascade so directional + spot occupy layers 0 and 1.
    app.world.spawn(
      new DirectionalLight3d(),
      new CascadeShadowConfig({ numCascades: 1 }),
      new Transform(),
    );
    app.world.spawn(
      new SpotLight3d({ range: 14, outerAngle: Math.PI / 6 }),
      new Transform(vec3.create(0, 6, 0)),
    );
    app.world.spawn(...Camera3d());
    await app.run();

    expect(app.getResource(Shadow3dState)!.shadowLightCount).toBe(2);
  });

  it('defaults the shadow filtering method to Hardware2x2 and packs it into shadow_flags.x', async () => {
    const { renderer } = makeCapturingRenderer();
    const { app, spawnMesh } = litApp(renderer);
    spawnMesh();
    app.world.spawn(new DirectionalLight3d(), new Transform());
    app.world.spawn(...Camera3d());
    await app.run();

    expect(app.getResource(Shadow3dSettings)!.filteringMethod).toBe(
      ShadowFilteringMethod.Hardware2x2,
    );
    // shadow_flags.x sits at u32 slot 2028 (after cascade_splits + the 12-mat
    // shadow_view_proj array). Default is the Hardware2x2 ordinal 0.
    expect(app.getResource(GpuLights)!.u32[2028]).toBe(0);
  });

  it('packs the active shadow filtering method into shadow_flags.x', async () => {
    const { renderer } = makeCapturingRenderer();
    const { app, spawnMesh } = litApp(renderer);
    spawnMesh();
    app.world.spawn(new DirectionalLight3d(), new Transform());
    app.world.spawn(...Camera3d());
    // Override before plugin defaults insert the resource.
    app.getResource(Shadow3dSettings)!.filteringMethod = ShadowFilteringMethod.Castano13;
    await app.run();

    expect(app.getResource(GpuLights)!.u32[2028]).toBe(1); // Castano13 ordinal

    app.getResource(Shadow3dSettings)!.filteringMethod = ShadowFilteringMethod.Pcf5x5;
    app.advanceFrame();
    expect(app.getResource(GpuLights)!.u32[2028]).toBe(2); // Pcf5x5 ordinal
  });

  it('gives a directional light one atlas layer per cascade and packs increasing splits', async () => {
    const { renderer } = makeCapturingRenderer();
    const { app, spawnMesh } = litApp(renderer);
    spawnMesh();
    app.world.spawn(
      new DirectionalLight3d(),
      new CascadeShadowConfig({ numCascades: 3, minimumDistance: 1, maximumDistance: 90 }),
      new Transform(),
    );
    app.world.spawn(...Camera3d());
    await app.run();

    const shadow = app.getResource(Shadow3dState)!;
    expect(shadow.shadowLightCount).toBe(3); // 3 cascades → 3 consecutive layers

    const lights = app.getResource(GpuLights)!;
    expect(lights.u32[7]).toBe(3); // counts.w = cascade count
    expect(lights.f32[8 + 3]).toBe(0); // directional.direction.w = cascade base layer
    // cascade_splits vec4 (f32 1832): strictly increasing, last == maximumDistance.
    expect(lights.f32[1832]!).toBeLessThan(lights.f32[1833]!);
    expect(lights.f32[1833]!).toBeLessThan(lights.f32[1834]!);
    expect(lights.f32[1834]!).toBeCloseTo(90);
  });
});
