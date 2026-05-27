import { describe, expect, it } from 'bun:test';

import type { Renderer } from '@retro-engine/renderer-core';

import {
  App,
  Camera3d,
  DirectionalLight3d,
  Light3dPlugin,
  MaterialPlugin,
  Mesh3d,
  Meshes,
  NotShadowCaster,
  Shadow3dState,
  Sphere,
  StandardMaterial,
  StandardMaterialPlugin,
  Transform,
} from '../index';
import { makeCapturingRenderer, makeStubCanvas } from '../test-utils';

const litApp = (renderer: Renderer) => {
  const app = new App({ renderer, canvas: makeStubCanvas() });
  app.addPlugin(new StandardMaterialPlugin());
  const plugin = new MaterialPlugin(StandardMaterial);
  app.addPlugin(plugin);
  app.addPlugin(new Light3dPlugin());
  const mesh = app.getResource(Meshes)!.add(new Sphere({ radius: 0.5 }).mesh().build());
  const material = app.getResource(plugin.Materials)!.add(new StandardMaterial());
  // Origin sits inside the default Camera3d frustum (an off-screen caster would
  // be frustum-culled before reaching the shadow queue).
  const spawn = (...extra: object[]) =>
    app.world.spawn(new Mesh3d(mesh), new plugin.MeshMaterial3d(material), new Transform(), ...extra);
  return { app, spawn };
};

describe('NotShadowCaster', () => {
  it('excludes a marked mesh from the shadow caster set', async () => {
    const { renderer, log } = makeCapturingRenderer();
    const { app, spawn } = litApp(renderer);
    spawn(new NotShadowCaster());
    app.world.spawn(new DirectionalLight3d(), new Transform());
    app.world.spawn(...Camera3d());
    await app.run();

    const shadow = app.getResource(Shadow3dState)!;
    // The light still claims a layer, but no geometry is collected to cast.
    expect(shadow.shadowLightCount).toBe(1);
    expect(shadow.casterBatches.length).toBe(0);
    // With nothing to render, the per-layer depth pass is skipped.
    expect(log.passes.find((p) => p.label?.startsWith('shadow3d_atlas_layer'))).toBeUndefined();
  });

  it('collects an unmarked mesh as a caster', async () => {
    const { renderer } = makeCapturingRenderer();
    const { app, spawn } = litApp(renderer);
    spawn();
    app.world.spawn(new DirectionalLight3d(), new Transform());
    app.world.spawn(...Camera3d());
    await app.run();

    expect(app.getResource(Shadow3dState)!.casterBatches.length).toBeGreaterThanOrEqual(1);
  });
});
