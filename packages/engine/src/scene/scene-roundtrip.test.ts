import { describe, expect, it } from 'bun:test';

import { World, type ComponentType, type Entity } from '@retro-engine/ecs';
import { asAssetIndex, generateAssetGuid, makeHandle, type Handle } from '@retro-engine/assets';
import { mat4, quat, vec3, type Color, type Mat4, type Quat, type Vec3 } from '@retro-engine/math';
import { t, TypeRegistry } from '@retro-engine/reflect';

import { deserializeScene } from './deserialize';
import type { SceneData } from './scene-data';
import { serializeWorld } from './serialize';

interface Image {
  readonly __image: 'image';
}

class Spatial {
  position: Vec3 = vec3.create(0, 0, 0);
  rotation: Quat = quat.identity();
  matrix: Mat4 = mat4.identity();
}

class Tint {
  color: Color = { r: 1, g: 1, b: 1, a: 1 };
}

class Stats {
  hp = 100;
  armor = 0;
}

class Hero {
  stats: Stats = new Stats();
  alias = '';
}

class Link {
  target: Entity | null = null;
}

class Decorated {
  icon: Handle<Image> = makeHandle<Image>(asAssetIndex(0));
}

class Meta {
  label?: string;
  cache = 'runtime';
}

const buildRegistry = (): TypeRegistry => {
  const reg = new TypeRegistry();
  reg.registerComponent(
    Spatial,
    { position: t.vec3, rotation: t.quat, matrix: t.mat4 },
    { name: 'Spatial' },
  );
  reg.registerComponent(Tint, { color: t.color }, { name: 'Tint' });
  reg.registerType(Stats, { hp: t.number, armor: t.number }, { name: 'Stats' });
  reg.registerComponent(Hero, { stats: t.type(Stats), alias: t.string }, { name: 'Hero' });
  reg.registerComponent(Link, { target: t.entity().nullable() }, { name: 'Link' });
  reg.registerComponent(Decorated, { icon: t.handle<Image>('Image') }, { name: 'Decorated' });
  reg.registerComponent(
    Meta,
    { label: t.string.optional(), cache: t.string.skip() },
    { name: 'Meta' },
  );
  return reg;
};

const find = <T extends object>(world: World, type: ComponentType<T>): Entity => {
  for (const entity of world.entities()) {
    if (world.getComponent(entity, type) !== undefined) return entity;
  }
  throw new Error(`no entity with the requested component`);
};

describe('scene round-trip', () => {
  it('round-trips a world through JSON with refs, handles, and nested types intact', () => {
    const reg = buildRegistry();
    const guid = generateAssetGuid();

    // Author a small graph in the source world.
    const source = new World();

    const spatial = new Spatial();
    spatial.position = vec3.create(1, 2, 3);
    const rotation = quat.identity();
    rotation[1] = 0.3;
    spatial.rotation = rotation;
    const matrix = mat4.identity();
    matrix[12] = 4;
    matrix[13] = 5;
    matrix[14] = 6;
    spatial.matrix = matrix;
    const tint = new Tint();
    tint.color = { r: 0.25, g: 0.5, b: 0.75, a: 1 };
    const hero = new Hero();
    hero.stats.hp = 42;
    hero.stats.armor = 7;
    hero.alias = 'Cid';
    const meta = new Meta();
    meta.cache = 'mutated-at-runtime'; // skip-serialized: should NOT survive

    const a = source.spawn(spatial, tint, hero, meta);

    const link = new Link();
    link.target = a; // entity reference into A
    source.spawn(new Spatial(), link);

    const decorated = new Decorated();
    decorated.icon = makeHandle<Image>(asAssetIndex(11), guid);
    source.spawn(decorated);

    // Serialize → JSON text → parse, proving the output is plain JSON.
    const sceneData: SceneData = JSON.parse(JSON.stringify(serializeWorld(source, reg)));

    // Load into a fresh world.
    const target = new World();
    const restoredIcon = makeHandle<Image>(asAssetIndex(99), guid);
    deserializeScene(sceneData, target, reg, {
      resolveHandle: (_assetType, g) =>
        g === guid ? restoredIcon : makeHandle<Image>(asAssetIndex(0)),
    });

    const a2 = find(target, Hero);
    const b2 = find(target, Link);
    const c2 = find(target, Decorated);

    // Math types survive as Float32Array with identical contents.
    const s2 = target.getComponent(a2, Spatial)!;
    expect(s2.position).toBeInstanceOf(Float32Array);
    expect(Array.from(s2.position)).toEqual([1, 2, 3]);
    expect(Array.from(s2.rotation)).toEqual(Array.from(spatial.rotation));
    expect(Array.from(s2.matrix)).toEqual(Array.from(spatial.matrix));

    // Color survives.
    expect(target.getComponent(a2, Tint)!.color).toEqual({ r: 0.25, g: 0.5, b: 0.75, a: 1 });

    // Nested registered type is reconstructed as its class.
    const h2 = target.getComponent(a2, Hero)!;
    expect(h2.stats).toBeInstanceOf(Stats);
    expect(h2.stats.hp).toBe(42);
    expect(h2.stats.armor).toBe(7);
    expect(h2.alias).toBe('Cid');

    // Entity reference is remapped to A's freshly-spawned entity in the new world.
    expect(target.getComponent(b2, Link)!.target).toBe(a2);

    // Asset handle survives by GUID and is resolved to a live, index-bearing handle.
    const icon = target.getComponent(c2, Decorated)!.icon;
    expect(icon.guid).toBe(guid);
    expect(icon.index).toBe(asAssetIndex(99));

    // Skip-serialized field kept its constructor default; optional field stayed unset.
    const m2 = target.getComponent(a2, Meta)!;
    expect(m2.cache).toBe('runtime');
    expect(m2.label).toBeUndefined();
  });

  it('maps a dangling entity reference to the null entity', () => {
    const reg = buildRegistry();
    // A scene whose Link points at an id that is not present.
    const scene: SceneData = {
      version: 1,
      entities: [
        { id: 0, components: [{ type: 'Link', version: 1, data: { target: 999 } }] },
      ],
    };
    const world = new World();
    deserializeScene(scene, world, reg);
    const e = find(world, Link);
    expect(world.getComponent(e, Link)!.target).toBe(0 as Entity);
  });

  it('throws when a scene has a handle field but no resolver is supplied', () => {
    const reg = buildRegistry();
    const scene: SceneData = {
      version: 1,
      entities: [
        { id: 0, components: [{ type: 'Decorated', version: 1, data: { icon: 'guid-x' } }] },
      ],
    };
    expect(() => deserializeScene(scene, new World(), reg)).toThrow(/resolveHandle/);
  });
});
