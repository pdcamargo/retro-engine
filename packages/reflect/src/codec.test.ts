import { describe, expect, it } from 'bun:test';

import type { Entity } from '@retro-engine/ecs';
import { asAssetIndex, generateAssetGuid, makeHandle, type Handle } from '@retro-engine/assets';

import type { DecodeEnv, EncodeEnv } from './codec';
import { decodeComponent, decodeValue, encodeComponent, encodeValue } from './codec';
import { t } from './field-type';
import { defaultRegistry, registerComponent, TypeRegistry } from './type-registry';

/** An encode context with identity entity ids and GUID-based handle refs. */
const encEnv = (registry: TypeRegistry): EncodeEnv => ({
  registry,
  entityId: (e) => e as unknown as number,
  handleRef: (_assetType, h) => h.guid,
});

/** A decode context with identity entity ids and an optional handle resolver. */
const decEnv = (
  registry: TypeRegistry,
  resolveHandle?: (assetType: string, guid: string) => Handle<unknown>,
): DecodeEnv => ({
  registry,
  entity: (id) => id as unknown as Entity,
  resolveHandle:
    resolveHandle ??
    (() => {
      throw new Error('codec.test: no handle resolver provided');
    }),
});

describe('encodeValue / decodeValue', () => {
  const reg = new TypeRegistry();
  const e = encEnv(reg);
  const d = decEnv(reg);

  it('round-trips primitives and enums', () => {
    for (const [ft, value] of [
      [t.number, 42],
      [t.string, 'hi'],
      [t.boolean, true],
      [t.enum('a', 'b'), 'b'],
    ] as const) {
      const json = encodeValue(ft, value, e);
      expect(json).toEqual(value);
      expect(decodeValue(ft, json, d)).toEqual(value);
    }
  });

  it('round-trips a vec3 through a plain number array', () => {
    const v = new Float32Array([1, 2, 3]);
    const json = encodeValue(t.vec3, v, e);
    expect(json).toEqual([1, 2, 3]);
    const back = decodeValue(t.vec3, json, d);
    expect(back).toBeInstanceOf(Float32Array);
    expect(Array.from(back as Float32Array)).toEqual([1, 2, 3]);
  });

  it('round-trips every Float32Array kind (vec2/vec4/quat/mat4)', () => {
    const cases = [
      [t.vec2, new Float32Array([1, 2])],
      [t.vec4, new Float32Array([1, 2, 3, 4])],
      [t.quat, new Float32Array([0, 0, 0, 1])],
      [t.mat4, new Float32Array(16).fill(2)],
    ] as const;
    for (const [ft, value] of cases) {
      const back = decodeValue(ft, encodeValue(ft, value, e), d);
      expect(back).toBeInstanceOf(Float32Array);
      expect(Array.from(back as Float32Array)).toEqual(Array.from(value));
    }
  });

  it('throws when decoding a handle with no resolver supplied', () => {
    expect(() => decodeValue(t.handle('Image'), 'some-guid', d)).toThrow();
  });

  it('round-trips a color as { r, g, b, a }', () => {
    const c = { r: 0.1, g: 0.2, b: 0.3, a: 1 };
    const json = encodeValue(t.color, c, e);
    expect(json).toEqual(c);
    expect(decodeValue(t.color, json, d)).toEqual(c);
  });

  it('round-trips arrays, tuples, and structs recursively', () => {
    expect(decodeValue(t.array(t.number), encodeValue(t.array(t.number), [1, 2, 3], e), d)).toEqual([
      1, 2, 3,
    ]);

    const tup = t.tuple(t.number, t.string);
    expect(decodeValue(tup, encodeValue(tup, [7, 'x'], e), d)).toEqual([7, 'x']);

    const st = t.struct({ x: t.number, label: t.string });
    expect(decodeValue(st, encodeValue(st, { x: 1, label: 'a' }, e), d)).toEqual({ x: 1, label: 'a' });
  });

  it('passes null and undefined through', () => {
    expect(encodeValue(t.number.nullable(), null, e)).toBeNull();
    expect(decodeValue(t.number.nullable(), null, d)).toBeNull();
    expect(encodeValue(t.number.optional(), undefined, e)).toBeUndefined();
    expect(decodeValue(t.number.optional(), undefined, d)).toBeUndefined();
  });

  it('remaps entity references through the context', () => {
    const remapEnc: EncodeEnv = {
      registry: reg,
      entityId: (entity) => (entity === (5 as Entity) ? 0 : -1),
      handleRef: () => undefined,
    };
    const remapDec: DecodeEnv = {
      registry: reg,
      entity: (id) => (id === 0 ? (99 as Entity) : (-1 as Entity)),
      resolveHandle: () => {
        throw new Error('unused');
      },
    };
    const encoded = encodeValue(t.entity(), 5 as Entity, remapEnc);
    expect(encoded).toBe(0);
    expect(decodeValue(t.entity(), encoded, remapDec)).toBe(99 as Entity);
  });

  it('serializes a handle by GUID and reconstructs it through the resolver', () => {
    const guid = generateAssetGuid();
    const original = makeHandle<unknown>(asAssetIndex(7), guid);
    const json = encodeValue(t.handle('Image'), original, e);
    expect(json).toBe(guid);

    const restored = makeHandle<unknown>(asAssetIndex(42), guid);
    const resolver = decEnv(reg, (_assetType, g) =>
      g === guid ? restored : makeHandle<unknown>(asAssetIndex(0)),
    );
    const back = decodeValue(t.handle('Image'), json, resolver) as Handle<unknown>;
    expect(back.guid).toBe(guid);
    expect(back.index).toBe(asAssetIndex(42));
  });

  it('omits a handle with no persistent GUID', () => {
    const runtimeOnly = makeHandle<unknown>(asAssetIndex(3));
    expect(encodeValue(t.handle('Image'), runtimeOnly, e)).toBeUndefined();
  });
});

describe('variant fields', () => {
  const reg = new TypeRegistry();
  const e = encEnv(reg);
  const d = decEnv(reg);

  it('round-trips tagged arms with and without payload', () => {
    const ft = t.variant('kind', { default: {}, none: {}, custom: { color: t.color } });
    for (const value of [
      { kind: 'default' },
      { kind: 'none' },
      { kind: 'custom', color: { r: 0.1, g: 0.2, b: 0.3, a: 1 } },
    ] as const) {
      const json = encodeValue(ft, value, e);
      expect(json).toEqual(value);
      expect(decodeValue(ft, json, d)).toEqual(value);
    }
  });

  it('round-trips a tagged arm carrying a typed numeric payload', () => {
    const ft = t.variant('kind', {
      windowSize: {},
      fixed: { width: t.number, height: t.number },
    });
    const fixed = { kind: 'fixed', width: 320, height: 180 };
    expect(decodeValue(ft, encodeValue(ft, fixed, e), d)).toEqual(fixed);
  });

  it('omits an arm whose discriminant names no schema arm, falling back to a default on load', () => {
    const ft = t.variant('kind', { primary: {} });
    // A runtime-only arm (a live GPU reference) is dropped rather than serialized.
    expect(encodeValue(ft, { kind: 'texture', texture: {} }, e)).toBeUndefined();
    expect(decodeValue(ft, undefined, d)).toBeUndefined();
  });

  it('round-trips the string-or-struct shape (bare string arms + untagged custom)', () => {
    const ft = t.variant(
      'kind',
      { center: {}, topLeft: {}, custom: { x: t.number, y: t.number } },
      { stringArms: true },
    );
    expect(encodeValue(ft, 'center', e)).toBe('center');
    expect(decodeValue(ft, 'center', d)).toBe('center');

    const custom = { x: 0.25, y: 1.2 };
    expect(encodeValue(ft, custom, e)).toEqual(custom);
    expect(decodeValue(ft, custom, d)).toEqual(custom);
  });
});

describe('encodeComponent / decodeComponent', () => {
  it('round-trips a component and reconstructs the class', () => {
    class Health {
      current = 100;
      max = 100;
    }
    const reg = new TypeRegistry();
    reg.registerComponent(Health, { current: t.number, max: t.number }, { name: 'Health' });
    const entry = reg.getByCtor(Health)!;

    const h = new Health();
    h.current = 30;
    const serialized = encodeComponent(entry, h, encEnv(reg));
    expect(serialized).toEqual({ type: 'Health', version: 1, data: { current: 30, max: 100 } });

    const back = decodeComponent(entry, serialized, decEnv(reg)) as Health;
    expect(back).toBeInstanceOf(Health);
    expect(back.current).toBe(30);
    expect(back.max).toBe(100);
  });

  it('reconstructs nested registered types as their class', () => {
    class Stats {
      str = 1;
      dex = 1;
    }
    class Hero {
      stats = new Stats();
      name = '';
    }
    const reg = new TypeRegistry();
    reg.registerType(Stats, { str: t.number, dex: t.number }, { name: 'Stats' });
    reg.registerComponent(Hero, { stats: t.type(Stats), name: t.string }, { name: 'Hero' });
    const entry = reg.getByCtor(Hero)!;

    const h = new Hero();
    h.stats.str = 99;
    h.name = 'Link';
    const back = decodeComponent(entry, encodeComponent(entry, h, encEnv(reg)), decEnv(reg)) as Hero;
    expect(back).toBeInstanceOf(Hero);
    expect(back.stats).toBeInstanceOf(Stats);
    expect(back.stats.str).toBe(99);
    expect(back.name).toBe('Link');
  });

  it('omits skip-serialized fields and keeps their constructor default on load', () => {
    class Cache {
      value = 0;
      transient = 'fresh';
    }
    const reg = new TypeRegistry();
    reg.registerComponent(
      Cache,
      { value: t.number, transient: t.string.skip() },
      { name: 'Cache' },
    );
    const entry = reg.getByCtor(Cache)!;

    const c = new Cache();
    c.value = 7;
    c.transient = 'mutated';
    const serialized = encodeComponent(entry, c, encEnv(reg));
    expect(serialized.data).toEqual({ value: 7 });

    const back = decodeComponent(entry, serialized, decEnv(reg)) as Cache;
    expect(back.transient).toBe('fresh');
  });

  it('applies default-if-missing for absent fields', () => {
    class Settings {
      volume = 0;
    }
    const reg = new TypeRegistry();
    reg.registerComponent(Settings, { volume: t.number.default(() => 0.5) }, { name: 'Settings' });
    const entry = reg.getByCtor(Settings)!;

    const back = decodeComponent(entry, { version: 1, data: {} }, decEnv(reg)) as Settings;
    expect(back.volume).toBe(0.5);
  });

  it('omits unset optional fields and restores nullable nulls', () => {
    class Node2 {
      label?: string;
      parent: Entity | null = null;
    }
    const reg = new TypeRegistry();
    reg.registerComponent(
      Node2,
      { label: t.string.optional(), parent: t.entity().nullable() },
      { name: 'Node2' },
    );
    const entry = reg.getByCtor(Node2)!;

    const n = new Node2();
    const serialized = encodeComponent(entry, n, encEnv(reg));
    expect(serialized.data).toEqual({ parent: null });

    const back = decodeComponent(entry, serialized, decEnv(reg)) as Node2;
    expect(back.label).toBeUndefined();
    expect(back.parent).toBeNull();
  });

  it('runs version migrations when loading older data', () => {
    class Player {
      hp = 100;
    }
    const reg = new TypeRegistry();
    reg.registerComponent(
      Player,
      { hp: t.number },
      {
        name: 'Player',
        version: 2,
        migrations: [{ to: 2, migrate: (data) => ({ hp: data.health }) }],
      },
    );
    const entry = reg.getByCtor(Player)!;

    const back = decodeComponent(entry, { version: 1, data: { health: 75 } }, decEnv(reg)) as Player;
    expect(back.hp).toBe(75);
  });
});

describe('FieldType modifiers', () => {
  it('records inspector hints without affecting serialization', () => {
    const ft = t.number.meta({ range: [0, 1], label: 'Volume' });
    expect(ft.kind).toBe('number');
    expect(ft.hints).toEqual({ range: [0, 1], label: 'Volume' });
    const reg = new TypeRegistry();
    expect(encodeValue(ft, 0.5, encEnv(reg))).toBe(0.5);
  });
});

describe('default registry helpers', () => {
  it('register into the shared default registry', () => {
    class Probe {
      x = 0;
    }
    registerComponent(Probe, { x: t.number }, { name: 'CodecTestDefaultProbe' });
    expect(defaultRegistry.get('CodecTestDefaultProbe')?.ctor).toBe(Probe);
    expect(defaultRegistry.getByCtor(Probe)?.name).toBe('CodecTestDefaultProbe');
  });
});
