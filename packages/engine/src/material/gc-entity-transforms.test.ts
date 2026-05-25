import { describe, expect, it } from 'bun:test';

import { vec4 } from '@retro-engine/math';

import { App, Camera3d, Cuboid, Mesh3d, Meshes } from '../index';
import { makeRenderingRenderer, makeStubCanvas } from '../test-utils';

import { MaterialPlugin } from './material-plugin';
import { EntityTransformGpuCache } from './mesh-3d-transforms';
import { UnlitMaterial, UnlitMaterialPlugin } from './unlit-material';

describe('gcEntityTransformsSystem', () => {
  it('keeps cache entries alive across frames while the entity stays visible', async () => {
    const app = new App({ renderer: makeRenderingRenderer(), canvas: makeStubCanvas() });
    app.addPlugin(new UnlitMaterialPlugin());
    const plugin = new MaterialPlugin(UnlitMaterial);
    app.addPlugin(plugin);

    const meshHandle = app.getResource(Meshes)!.add(new Cuboid().mesh().build());
    const materialHandle = app
      .getResource(plugin.Materials)!
      .add(new UnlitMaterial({ color: vec4.create(1, 1, 1, 1) }));
    const entity = app.world.spawn(
      new Mesh3d(meshHandle),
      new plugin.MeshMaterial3d(materialHandle),
    );
    app.world.spawn(...Camera3d());

    await app.run();
    const cache = app.getResource(EntityTransformGpuCache)!;
    expect(cache.perEntity.has(entity)).toBe(true);
    // After GC has run, liveThisFrame is cleared so the next frame restarts clean.
    expect(cache.liveThisFrame.size).toBe(0);
  });

  it('evicts cache entries for entities that stopped being queued', async () => {
    const app = new App({ renderer: makeRenderingRenderer(), canvas: makeStubCanvas() });
    app.addPlugin(new UnlitMaterialPlugin());
    const plugin = new MaterialPlugin(UnlitMaterial);
    app.addPlugin(plugin);

    const meshHandle = app.getResource(Meshes)!.add(new Cuboid().mesh().build());
    const materialHandle = app
      .getResource(plugin.Materials)!
      .add(new UnlitMaterial({ color: vec4.create(1, 1, 1, 1) }));
    const entity = app.world.spawn(
      new Mesh3d(meshHandle),
      new plugin.MeshMaterial3d(materialHandle),
    );
    app.world.spawn(...Camera3d());

    await app.run();
    const cache = app.getResource(EntityTransformGpuCache)!;
    expect(cache.perEntity.has(entity)).toBe(true);

    app.world.despawn(entity);
    await app.run();
    expect(cache.perEntity.has(entity)).toBe(false);
  });

  it('two material plugins sharing the cache do not evict each other', async () => {
    class OtherUnlitMaterial extends UnlitMaterial {}
    Object.defineProperty(OtherUnlitMaterial, 'name', { value: 'OtherUnlitMaterial' });

    const app = new App({ renderer: makeRenderingRenderer(), canvas: makeStubCanvas() });
    app.addPlugin(new UnlitMaterialPlugin());
    const pluginA = new MaterialPlugin(UnlitMaterial);
    const pluginB = new MaterialPlugin(OtherUnlitMaterial);
    app.addPlugin(pluginA);
    app.addPlugin(pluginB);

    const meshHandle = app.getResource(Meshes)!.add(new Cuboid().mesh().build());
    const matA = app
      .getResource(pluginA.Materials)!
      .add(new UnlitMaterial({ color: vec4.create(1, 1, 1, 1) }));
    const matB = app
      .getResource(pluginB.Materials)!
      .add(new OtherUnlitMaterial({ color: vec4.create(0.5, 0.5, 0.5, 1) }));
    const entityA = app.world.spawn(
      new Mesh3d(meshHandle),
      new pluginA.MeshMaterial3d(matA),
    );
    const entityB = app.world.spawn(
      new Mesh3d(meshHandle),
      new pluginB.MeshMaterial3d(matB),
    );
    app.world.spawn(...Camera3d());

    await app.run();
    const cache = app.getResource(EntityTransformGpuCache)!;
    expect(cache.perEntity.has(entityA)).toBe(true);
    expect(cache.perEntity.has(entityB)).toBe(true);

    // Second frame: both plugins re-queue. Neither should have evicted the
    // other's entry — the entries should still be the same buffer instances
    // (not destroyed-and-recreated between frames).
    const slotsABefore = cache.perEntity.get(entityA)!;
    const slotsBBefore = cache.perEntity.get(entityB)!;
    await app.run();
    expect(cache.perEntity.get(entityA)).toBe(slotsABefore);
    expect(cache.perEntity.get(entityB)).toBe(slotsBBefore);
  });
});
