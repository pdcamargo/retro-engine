import { describe, expect, it } from 'bun:test';

import { World } from '@retro-engine/ecs';
import { asAssetIndex, generateAssetGuid, makeHandle } from '@retro-engine/assets';
import { quat } from '@retro-engine/math';

import {
  App,
  AppTypeRegistry,
  Camera3d,
  Core3dLabel,
  Image,
  Images,
  OpaquePass3dLabel,
  RenderGraph,
  ShaderRegistry,
  Skybox,
  SkyboxPass3dLabel,
  SkyboxPlugin,
  TransparentPass3dLabel,
} from '../index';
import { deserializeScene } from '../scene/deserialize';
import type { SceneData } from '../scene/scene-data';
import { serializeWorld } from '../scene/serialize';
import { makeCapturingRenderer, makeStubCanvas } from '../test-utils';

const buildApp = () => {
  const { renderer } = makeCapturingRenderer();
  const app = new App({ renderer, canvas: makeStubCanvas() });
  app.addPlugin(new SkyboxPlugin());
  return app;
};

describe('SkyboxPlugin', () => {
  it('registers the skybox shader and the Skybox component schema', () => {
    const app = buildApp();
    expect(app.getResource(ShaderRegistry)!.has('retro_engine::skybox')).toBe(true);
    const registry = app.getResource(AppTypeRegistry)!.registry;
    expect(registry.has('Skybox')).toBe(true);
  });

  it('throws when a custom shader module is named but not registered', () => {
    const { renderer } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    expect(() => app.addPlugin(new SkyboxPlugin({ shaderModule: 'game::aurora_sky' }))).toThrow(
      /custom shader module 'game::aurora_sky' is not registered/,
    );
  });

  it('inserts the skybox pass between the opaque and transparent passes', async () => {
    const app = buildApp();
    app.world.spawn(...Camera3d());
    await app.run();

    const ordered = app
      .getResource(RenderGraph)!
      .getSubGraph(Core3dLabel)!
      .orderedNodes()!
      .map((n) => String(n.label));
    const opaque = ordered.indexOf(String(OpaquePass3dLabel));
    const skybox = ordered.indexOf(String(SkyboxPass3dLabel));
    const transparent = ordered.indexOf(String(TransparentPass3dLabel));
    expect(skybox).toBeGreaterThan(opaque);
    expect(transparent).toBeGreaterThan(skybox);
  });

  it('round-trips the Skybox component through serialization', () => {
    const app = buildApp();
    const registry = app.getResource(AppTypeRegistry)!.registry;
    const guid = generateAssetGuid();

    const source = new World();
    const rotation = quat.identity();
    rotation[1] = 0.5;
    source.spawn(
      new Skybox({
        image: makeHandle<Image>(asAssetIndex(7), guid),
        brightness: 2.5,
        rotation,
      }),
    );

    const sceneData: SceneData = JSON.parse(JSON.stringify(serializeWorld(source, registry)));

    const target = new World();
    const restored = makeHandle<Image>(asAssetIndex(42), guid);
    deserializeScene(sceneData, target, registry, {
      resolveHandle: (_assetType, g) =>
        g === guid ? restored : makeHandle<Image>(asAssetIndex(0)),
    });

    let restoredSky: Skybox | undefined;
    for (const entity of target.entities()) {
      const found = target.getComponent(entity, Skybox);
      if (found !== undefined) restoredSky = found;
    }
    expect(restoredSky).toBeInstanceOf(Skybox);
    expect(restoredSky!.brightness).toBe(2.5);
    expect(Array.from(restoredSky!.rotation)).toEqual(Array.from(rotation));
    expect(restoredSky!.image.guid).toBe(guid);
  });

  it('draws one fullscreen triangle into the camera target when a cube image is bound', async () => {
    const { renderer, log } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.addPlugin(new SkyboxPlugin());

    const cube = app.getResource(Images)!.add(
      Image.fromBytes({
        data: new Uint8Array(6 * 4),
        format: 'rgba8unorm',
        width: 1,
        height: 1,
        depthOrArrayLayers: 6,
        dimension: 'cube',
        label: 'test-sky-cube',
      }),
    );
    app.world.spawn(...Camera3d({ hdr: true }), new Skybox({ image: cube }));

    await app.run();
    app.advanceFrame(16);

    const skyPass = log.passes.find((p) => p.label?.endsWith('.skybox'));
    expect(skyPass).toBeDefined();
    const draw = skyPass!.drawCalls.find((c) => c.kind === 'draw');
    expect(draw?.draw?.vertexCount).toBe(3);
    // View at @group(0), skybox resources at @group(1).
    const boundGroups = skyPass!.drawCalls
      .filter((c) => c.kind === 'setBindGroup')
      .map((c) => c.bindGroup!.index)
      .sort();
    expect(boundGroups).toEqual([0, 1]);
  });
});
