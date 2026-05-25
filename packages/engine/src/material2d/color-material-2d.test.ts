import { describe, expect, it } from 'bun:test';

import { vec2, vec4 } from '@retro-engine/math';

import {
  App,
  Camera2d,
  Mesh2d,
  Meshes,
  Rectangle,
  Sprite,
  SpritePlugin,
  ViewPhases2d,
} from '../index';
import { makeCapturingRenderer, makeStubCanvas } from '../test-utils';

import { ColorMaterial2d, ColorMaterial2dPlugin } from './color-material-2d';
import { Material2dPlugin } from './material-2d-plugin';

const setupApp = () => {
  const { renderer, log } = makeCapturingRenderer();
  const app = new App({ renderer, canvas: makeStubCanvas() });
  app.addPlugin(new ColorMaterial2dPlugin());
  const plugin = new Material2dPlugin(ColorMaterial2d);
  app.addPlugin(plugin);
  const meshHandle = app
    .getResource(Meshes)!
    .add(new Rectangle({ width: 32, height: 32 }).mesh().build());
  return { app, log, plugin, meshHandle };
};

describe('ColorMaterial2d alpha bucketing', () => {
  it("alphaMode 'opaque' routes into the opaque2d pass", async () => {
    const { app, log, plugin, meshHandle } = setupApp();
    const material = app
      .getResource(plugin.Materials2d)!
      .add(new ColorMaterial2d({ color: vec4.create(1, 1, 1, 1) }));
    app.world.spawn(new Mesh2d(meshHandle), new plugin.MeshMaterial2d(material));
    app.world.spawn(...Camera2d());
    await app.run();

    const opaque = log.passes.find((p) => p.label?.endsWith('.opaque2d'));
    expect(opaque?.drawCalls.filter((c) => c.kind === 'drawIndexed')).toHaveLength(1);
    expect(log.passes.find((p) => p.label?.endsWith('.transparent2d'))).toBeUndefined();
  });

  it("alphaMode 'opaque' ignores color.w (no automatic routing to transparent)", async () => {
    const { app, log, plugin, meshHandle } = setupApp();
    const material = app
      .getResource(plugin.Materials2d)!
      .add(
        new ColorMaterial2d({
          color: vec4.create(1, 1, 1, 0.25),
          // alphaMode left as default 'opaque' — color.w should not auto-promote.
        }),
      );
    app.world.spawn(new Mesh2d(meshHandle), new plugin.MeshMaterial2d(material));
    app.world.spawn(...Camera2d());
    await app.run();

    const opaque = log.passes.find((p) => p.label?.endsWith('.opaque2d'));
    expect(opaque?.drawCalls.filter((c) => c.kind === 'drawIndexed')).toHaveLength(1);
    expect(log.passes.find((p) => p.label?.endsWith('.transparent2d'))).toBeUndefined();
  });

  it("alphaMode 'blend' routes into the transparent2d pass", async () => {
    const { app, log, plugin, meshHandle } = setupApp();
    const material = app
      .getResource(plugin.Materials2d)!
      .add(
        new ColorMaterial2d({
          color: vec4.create(1, 1, 1, 0.5),
          alphaMode: 'blend',
        }),
      );
    app.world.spawn(new Mesh2d(meshHandle), new plugin.MeshMaterial2d(material));
    app.world.spawn(...Camera2d());
    await app.run();

    const transparent = log.passes.find((p) => p.label?.endsWith('.transparent2d'));
    expect(transparent).toBeDefined();
    expect(transparent!.drawCalls.filter((c) => c.kind === 'drawIndexed')).toHaveLength(1);
    const opaque = log.passes.find((p) => p.label?.endsWith('.opaque2d'));
    expect(opaque?.drawCalls.filter((c) => c.kind === 'drawIndexed')).toHaveLength(0);
  });

  it("alphaMode 'mask' lights up the alphaMask2d slot via ViewPhases2d", async () => {
    const { app, plugin, meshHandle } = setupApp();
    const material = app
      .getResource(plugin.Materials2d)!
      .add(
        new ColorMaterial2d({
          color: vec4.create(1, 1, 1, 1),
          alphaMode: { kind: 'mask', cutoff: 0.5 },
        }),
      );
    app.world.spawn(new Mesh2d(meshHandle), new plugin.MeshMaterial2d(material));
    const cameraEntity = app.world.spawn(...Camera2d());
    await app.run();

    const phases = app.getResource(ViewPhases2d)!;
    expect(phases.alphaMask.get(cameraEntity)?.length).toBe(1);
    expect(phases.opaque.get(cameraEntity)?.length ?? 0).toBe(0);
    expect(phases.transparent.get(cameraEntity)?.length ?? 0).toBe(0);
  });

  it('mixed Sprite + Material2d scene routes each draw into its own bucket', async () => {
    const { renderer, log } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.addPlugin(new SpritePlugin());
    app.addPlugin(new ColorMaterial2dPlugin());
    const plugin = new Material2dPlugin(ColorMaterial2d);
    app.addPlugin(plugin);
    const meshHandle = app
      .getResource(Meshes)!
      .add(new Rectangle({ width: 32, height: 32 }).mesh().build());

    // One opaque sprite, one opaque ColorMaterial2d entity, one blend
    // ColorMaterial2d entity.
    app.world.spawn(
      new Sprite({
        color: vec4.create(1, 1, 1, 1),
        customSize: vec2.create(16, 16),
      }),
    );
    const matOpaque = app
      .getResource(plugin.Materials2d)!
      .add(new ColorMaterial2d({ color: vec4.create(0.2, 0.6, 1, 1) }));
    const matBlend = app
      .getResource(plugin.Materials2d)!
      .add(
        new ColorMaterial2d({
          color: vec4.create(0.5, 1, 0.5, 0.5),
          alphaMode: 'blend',
        }),
      );
    app.world.spawn(new Mesh2d(meshHandle), new plugin.MeshMaterial2d(matOpaque));
    app.world.spawn(new Mesh2d(meshHandle), new plugin.MeshMaterial2d(matBlend));
    app.world.spawn(...Camera2d());
    await app.run();

    const opaque = log.passes.find((p) => p.label?.endsWith('.opaque2d'));
    // 1 sprite draw + 1 material2d draw.
    expect(opaque?.drawCalls.filter((c) => c.kind === 'drawIndexed')).toHaveLength(2);
    const transparent = log.passes.find((p) => p.label?.endsWith('.transparent2d'));
    expect(transparent?.drawCalls.filter((c) => c.kind === 'drawIndexed')).toHaveLength(1);
  });
});
