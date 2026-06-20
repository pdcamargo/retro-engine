import { describe, expect, it } from 'bun:test';

import { World } from '@retro-engine/ecs';
import { asAssetIndex, generateAssetGuid, makeHandle } from '@retro-engine/assets';
import { quat } from '@retro-engine/math';

import {
  App,
  AppTypeRegistry,
  Camera3d,
  EnvironmentMapLight,
  EnvironmentMapPlugin,
  Image,
  Images,
  Light3dPlugin,
  MaterialPlugin,
  RenderEnvironmentMaps,
  ShaderRegistry,
  StandardMaterial,
  StandardMaterialPlugin,
} from '../index';
import { deserializeScene } from '../scene/deserialize';
import type { SceneData } from '../scene/scene-data';
import { serializeWorld } from '../scene/serialize';
import { makeCapturingRenderer, makeStubCanvas } from '../test-utils';

const buildApp = () => {
  const { renderer } = makeCapturingRenderer();
  const app = new App({ renderer, canvas: makeStubCanvas() });
  app.addPlugin(new StandardMaterialPlugin());
  app.addPlugin(new MaterialPlugin(StandardMaterial));
  app.addPlugin(new Light3dPlugin());
  app.addPlugin(new EnvironmentMapPlugin());
  return app;
};

const makeCubeImage = (): Image =>
  Image.fromBytes({
    data: new Uint8Array(6 * 4),
    format: 'rgba8unorm',
    width: 1,
    height: 1,
    depthOrArrayLayers: 6,
    dimension: 'cube',
    label: 'test-env-cube',
  });

describe('EnvironmentMapPlugin', () => {
  it('registers the prefilter shader and the EnvironmentMapLight schema', () => {
    const app = buildApp();
    expect(app.getResource(ShaderRegistry)!.has('retro_engine::environment_prefilter')).toBe(true);
    expect(app.getResource(AppTypeRegistry)!.registry.has('EnvironmentMapLight')).toBe(true);
  });

  it('prefilters the active environment once and caches it', async () => {
    const app = buildApp();
    const cube = app.getResource(Images)!.add(makeCubeImage());
    app.world.spawn(...Camera3d({ hdr: true }), new EnvironmentMapLight({ environmentMap: cube }));

    await app.run();
    app.advanceFrame(16);

    expect(app.getResource(RenderEnvironmentMaps)!.has(cube.index)).toBe(true);
  });

  it('round-trips the EnvironmentMapLight component through serialization', () => {
    const app = buildApp();
    const registry = app.getResource(AppTypeRegistry)!.registry;
    const guid = generateAssetGuid();

    const source = new World();
    const rotation = quat.identity();
    rotation[2] = 0.4;
    source.spawn(
      new EnvironmentMapLight({
        environmentMap: makeHandle<Image>(asAssetIndex(3), guid),
        intensity: 1.5,
        diffuseIntensity: 0.8,
        specularIntensity: 1.2,
        rotation,
      }),
    );

    const sceneData: SceneData = JSON.parse(JSON.stringify(serializeWorld(source, registry)));

    const target = new World();
    const restored = makeHandle<Image>(asAssetIndex(50), guid);
    deserializeScene(sceneData, target, registry, {
      resolveHandle: (_t, g) => (g === guid ? restored : makeHandle<Image>(asAssetIndex(0))),
    });

    let found: EnvironmentMapLight | undefined;
    for (const entity of target.entities()) {
      const c = target.getComponent(entity, EnvironmentMapLight);
      if (c !== undefined) found = c;
    }
    expect(found).toBeInstanceOf(EnvironmentMapLight);
    expect(found!.intensity).toBe(1.5);
    expect(found!.diffuseIntensity).toBe(0.8);
    expect(found!.specularIntensity).toBe(1.2);
    expect(found!.environmentMap.guid).toBe(guid);
    expect(Array.from(found!.rotation)).toEqual(Array.from(rotation));
  });
});
