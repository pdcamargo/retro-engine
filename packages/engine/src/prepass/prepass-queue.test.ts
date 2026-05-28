import { vec4 } from '@retro-engine/math';
import { describe, expect, it } from 'bun:test';

import { App, Camera3d, Cuboid, Mesh3d, Meshes } from '../index';
import { MaterialPlugin } from '../material/material-plugin';
import { UnlitMaterial, UnlitMaterialPlugin } from '../material/unlit-material';
import { ViewPhases3d } from '../render-graph/phase-3d';
import { makeRenderingRenderer, makeStubCanvas } from '../test-utils';

import { DepthPrepass } from './components';
import { PrepassPlugin } from './prepass-plugin';

describe('Material prepass queueing (depth-only)', () => {
  it('pushes a prepass phase item when camera has DepthPrepass and material opts in', async () => {
    const app = new App({
      renderer: makeRenderingRenderer(),
      canvas: makeStubCanvas(),
    });
    app.addPlugin(new UnlitMaterialPlugin());
    const matPlugin = new MaterialPlugin(UnlitMaterial);
    app.addPlugin(matPlugin);
    app.addPlugin(new PrepassPlugin());

    const meshHandle = app.getResource(Meshes)!.add(new Cuboid().mesh().build());
    const matHandle = app
      .getResource(matPlugin.Materials)!
      .add(new UnlitMaterial({ color: vec4.create(1, 1, 1, 1) }));
    app.world.spawn(new Mesh3d(meshHandle), new matPlugin.MeshMaterial3d(matHandle));
    const cameraEntity = app.world.spawn(...Camera3d(), new DepthPrepass());
    void cameraEntity;

    await app.run();
    app.stop();

    const phases = app.getResource(ViewPhases3d)!;
    let totalPrepassItems = 0;
    for (const items of phases.prepass.values()) totalPrepassItems += items.length;
    expect(totalPrepassItems).toBeGreaterThan(0);
  });

  it('does NOT push a prepass item when the camera has no prepass marker', async () => {
    const app = new App({
      renderer: makeRenderingRenderer(),
      canvas: makeStubCanvas(),
    });
    app.addPlugin(new UnlitMaterialPlugin());
    const matPlugin = new MaterialPlugin(UnlitMaterial);
    app.addPlugin(matPlugin);
    app.addPlugin(new PrepassPlugin());

    const meshHandle = app.getResource(Meshes)!.add(new Cuboid().mesh().build());
    const matHandle = app
      .getResource(matPlugin.Materials)!
      .add(new UnlitMaterial({ color: vec4.create(1, 1, 1, 1) }));
    app.world.spawn(new Mesh3d(meshHandle), new matPlugin.MeshMaterial3d(matHandle));
    app.world.spawn(...Camera3d());

    await app.run();
    app.stop();

    const phases = app.getResource(ViewPhases3d)!;
    let totalPrepassItems = 0;
    for (const items of phases.prepass.values()) totalPrepassItems += items.length;
    expect(totalPrepassItems).toBe(0);
  });
});
