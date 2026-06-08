import { describe, expect, it } from 'bun:test';

import { World, type Entity } from '@retro-engine/ecs';
import { asAssetIndex, generateAssetGuid, makeHandle, type Handle } from '@retro-engine/assets';
import { t } from '@retro-engine/reflect';
import { vec3 } from '@retro-engine/math';

import { App, AppTypeRegistry, Mesh, Name } from '../index';
import { serializeScene, serializeWorld } from './serialize';
import { spawnScene } from './spawn';
import type { SceneData } from './scene-data';
import { makeHeadlessRenderer } from '../test-utils';

// --- synthetic authored resources, registered per test App ---

/** A registered world-settings resource exercising vec3 / number / enum / boolean. */
class WorldSettings {
  tint = vec3.create(1, 1, 1);
  intensity = 1;
  mode: 'day' | 'night' = 'day';
  fog = false;
}

/** A runtime-only cache that is never registered, so it must never serialize. */
class Volatile {
  scratch = 'runtime';
}

/** A registered resource with one persisted field and one `.skip()` field. */
class SkippingResource {
  persisted = 0;
  cache = 'default';
}

/** A registered resource holding an asset handle and an entity reference. */
class HandleHolder {
  icon: Handle<Mesh> = makeHandle<Mesh>(asAssetIndex(0));
  marker: Entity = 0 as Entity;
}

const findByName = (world: World, name: string): Entity => {
  for (const entity of world.entities()) {
    if (world.getComponent(entity, Name)?.value === name) return entity;
  }
  throw new Error(`no entity named '${name}'`);
};

const resourceOf = (scene: SceneData, type: string) =>
  (scene.resources ?? []).find((r) => r.type === type);

describe('resource serialization round-trip', () => {
  it('serializes a registered resource and omits an unregistered one', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    app.registerResource(
      WorldSettings,
      { tint: t.vec3, intensity: t.number, mode: t.enum('day', 'night'), fog: t.boolean },
      { name: 'WorldSettings' },
    );
    const settings = new WorldSettings();
    settings.tint = vec3.create(0.2, 0.4, 0.6);
    settings.intensity = 3;
    settings.mode = 'night';
    settings.fog = true;
    app.insertResource(settings);
    app.insertResource(new Volatile());

    const scene: SceneData = JSON.parse(JSON.stringify(serializeScene(app)));

    // The registered resource is captured; the unregistered cache is not; the
    // engine's own ClearColor (registered by CameraPlugin) rides along too.
    expect(resourceOf(scene, 'WorldSettings')).toBeDefined();
    expect(resourceOf(scene, 'Volatile')).toBeUndefined();
    expect(resourceOf(scene, 'ClearColor')).toBeDefined();

    const app2 = new App({ renderer: makeHeadlessRenderer() });
    app2.registerResource(
      WorldSettings,
      { tint: t.vec3, intensity: t.number, mode: t.enum('day', 'night'), fog: t.boolean },
      { name: 'WorldSettings' },
    );
    spawnScene(app2, scene);

    const restored = app2.getResource(WorldSettings)!;
    expect(restored).toBeInstanceOf(WorldSettings);
    expect(Array.from(restored.tint)).toEqual([
      Math.fround(0.2),
      Math.fround(0.4),
      Math.fround(0.6),
    ]);
    expect(restored.intensity).toBe(3);
    expect(restored.mode).toBe('night');
    expect(restored.fog).toBe(true);
  });

  it('drops a `.skip()` field on load while persisting the rest', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    app.registerResource(
      SkippingResource,
      { persisted: t.number, cache: t.string.skip() },
      { name: 'SkippingResource' },
    );
    const r = new SkippingResource();
    r.persisted = 42;
    r.cache = 'mutated-at-runtime';
    app.insertResource(r);

    const scene: SceneData = JSON.parse(JSON.stringify(serializeScene(app)));
    const entry = resourceOf(scene, 'SkippingResource')!;
    expect(entry.data.persisted).toBe(42);
    expect('cache' in entry.data).toBe(false);

    const app2 = new App({ renderer: makeHeadlessRenderer() });
    app2.registerResource(
      SkippingResource,
      { persisted: t.number, cache: t.string.skip() },
      { name: 'SkippingResource' },
    );
    spawnScene(app2, scene);

    const out = app2.getResource(SkippingResource)!;
    expect(out.persisted).toBe(42);
    expect(out.cache).toBe('default'); // ctor default, not the mutated runtime value
  });

  it('remaps entity refs and resolves handles on a resource, exactly like a component', () => {
    const guid = generateAssetGuid();
    const app = new App({ renderer: makeHeadlessRenderer() });
    app.registerResource(
      HandleHolder,
      { icon: t.handle<Mesh>('Mesh'), marker: t.entity() },
      { name: 'HandleHolder' },
    );
    const target = app.world.spawn(new Name('target'));
    const holder = new HandleHolder();
    holder.icon = makeHandle<Mesh>(asAssetIndex(5), guid);
    holder.marker = target;
    app.insertResource(holder);

    const scene: SceneData = JSON.parse(JSON.stringify(serializeScene(app)));

    const app2 = new App({ renderer: makeHeadlessRenderer() });
    app2.registerResource(
      HandleHolder,
      { icon: t.handle<Mesh>('Mesh'), marker: t.entity() },
      { name: 'HandleHolder' },
    );
    const restoredHandle = makeHandle<Mesh>(asAssetIndex(99), guid);
    spawnScene(app2, scene, undefined, {
      resolveHandle: (_assetType, g) => (g === guid ? restoredHandle : makeHandle(asAssetIndex(0))),
    });

    const out = app2.getResource(HandleHolder)!;
    expect(out.icon.guid).toBe(guid); // resolved by GUID
    expect(out.marker).toBe(findByName(app2.world, 'target')); // remapped to the respawned entity
  });
});

describe('resource serialization — additive / back-compat', () => {
  it('the bare-world serialize path never emits a resources key', () => {
    const world = new World();
    world.spawn(new Name('lonely'));
    const reg = new App({ renderer: makeHeadlessRenderer() }).getResource(AppTypeRegistry)!.registry;
    const scene = serializeWorld(world, reg);
    expect('resources' in scene).toBe(false);
  });

  it('spawns a scene that has no resources key without throwing', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const scene: SceneData = {
      version: 1,
      entities: [{ id: 0, components: [{ type: 'Name', version: 1, data: { value: 'a' } }] }],
    };
    expect(() => spawnScene(app, scene)).not.toThrow();
    expect(findByName(app.world, 'a')).toBeDefined();
  });
});
