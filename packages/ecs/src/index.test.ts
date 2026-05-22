import { describe, expect, it } from 'bun:test';

import { type ComponentType, Disabled, Query, World } from './index';

class Position {
  constructor(
    public x = 0,
    public y = 0,
  ) {}
}

class Velocity {
  static requires: ComponentType[] = [Position];
  constructor(
    public vx = 0,
    public vy = 0,
  ) {}
}

class Marker {}

describe('World — spawn / despawn / preserved surface', () => {
  it('spawns entities with distinct ids', () => {
    const world = new World();
    const a = world.spawn();
    const b = world.spawn();
    expect(a).not.toBe(b);
    expect([...world.entities()]).toContain(a);
    expect([...world.entities()]).toContain(b);
  });

  it('spawn is variadic and accepts an array bundle', () => {
    const world = new World();
    const a = world.spawn(new Position(1, 2));
    const b = world.spawn(new Position(3, 4), new Velocity(5, 6));
    const c = world.spawn([new Position(7, 8), new Velocity(9, 10)]);

    expect(world.getComponent(a, Position)).toEqual({ x: 1, y: 2 });
    expect(world.getComponent(b, Position)).toEqual({ x: 3, y: 4 });
    expect(world.getComponent(b, Velocity)).toEqual({ vx: 5, vy: 6 });
    expect(world.getComponent(c, Position)).toEqual({ x: 7, y: 8 });
    expect(world.getComponent(c, Velocity)).toEqual({ vx: 9, vy: 10 });
  });

  it('addComponent + getComponent + has round-trip preserves a single component', () => {
    const world = new World();
    const e = world.spawn();
    world.addComponent(e, Position, new Position(1, 2));
    expect(world.has(e, Position)).toBe(true);
    expect(world.getComponent(e, Position)).toEqual({ x: 1, y: 2 });
  });

  it('removeComponent + despawn clear visibility cleanly', () => {
    const world = new World();
    const e = world.spawn(new Position(1, 2));
    world.removeComponent(e, Position);
    expect(world.has(e, Position)).toBe(false);
    expect(world.getComponent(e, Position)).toBeUndefined();
    world.despawn(e);
    expect([...world.entities()]).not.toContain(e);
    expect(world.getComponent(e, Position)).toBeUndefined();
  });
});

describe('World — archetype transitions', () => {
  it('add preserves existing component data when moving archetype', () => {
    const world = new World();
    const e = world.spawn(new Position(7, 8));
    world.addComponent(e, Velocity, new Velocity(1, 2));
    expect(world.getComponent(e, Position)).toEqual({ x: 7, y: 8 });
    expect(world.getComponent(e, Velocity)).toEqual({ vx: 1, vy: 2 });
  });

  it('remove preserves remaining component data when moving archetype', () => {
    const world = new World();
    const e = world.spawn(new Position(7, 8), new Velocity(1, 2));
    world.removeComponent(e, Velocity);
    expect(world.has(e, Velocity)).toBe(false);
    expect(world.getComponent(e, Position)).toEqual({ x: 7, y: 8 });
  });

  it('swap-remove keeps the rest of the archetype intact when an interior row is removed', () => {
    const world = new World();
    const a = world.spawn(new Position(1, 1));
    const b = world.spawn(new Position(2, 2));
    const c = world.spawn(new Position(3, 3));
    world.despawn(b);
    expect(world.getComponent(a, Position)).toEqual({ x: 1, y: 1 });
    expect(world.getComponent(c, Position)).toEqual({ x: 3, y: 3 });
    expect(world.has(b, Position)).toBe(false);
  });

  it('entity(e) builder chains insert and remove', () => {
    const world = new World();
    const e = world.spawn();
    world
      .entity(e)
      .insert(new Position(5, 6), new Velocity(1, 0))
      .remove(Velocity);
    expect(world.getComponent(e, Position)).toEqual({ x: 5, y: 6 });
    expect(world.has(e, Velocity)).toBe(false);
  });
});

describe('World — multi-component queries', () => {
  it('iterates only archetypes that contain every requested type', () => {
    const world = new World();
    world.spawn(new Position(1, 1));
    const b = world.spawn(new Position(2, 2), new Velocity(10, 0));
    const c = world.spawn(new Position(3, 3), new Velocity(20, 0));
    const rows = [...world.query([Position, Velocity])];
    expect(rows).toHaveLength(2);
    const ids = new Set(rows.map(([p]) => p.x));
    expect(ids.has(world.getComponent(b, Position)!.x)).toBe(true);
    expect(ids.has(world.getComponent(c, Position)!.x)).toBe(true);
  });

  it('Query.count, Query.first, Query.single handle 0 / 1 / many', () => {
    const world = new World();
    const empty = world.query([Position]);
    expect(empty.count()).toBe(0);
    expect(empty.first()).toBeUndefined();
    expect(() => empty.single()).toThrow(/got 0/);

    world.spawn(new Position(1, 2));
    const one = world.query([Position]);
    expect(one.count()).toBe(1);
    expect(one.first()).toEqual([{ x: 1, y: 2 }]);
    expect(one.single()).toEqual([{ x: 1, y: 2 }]);

    world.spawn(new Position(3, 4));
    const many = world.query([Position]);
    expect(many.count()).toBe(2);
    expect(() => many.single()).toThrow(/at least 2/);
  });

  it('1000-entity smoke query yields every row', () => {
    const world = new World();
    for (let i = 0; i < 1000; i++) world.spawn(new Position(i, i), new Velocity(1, 1));
    expect(world.query([Position, Velocity]).count()).toBe(1000);
  });

  it('tag components (empty class) round-trip and are queryable', () => {
    const world = new World();
    const tagged = world.spawn(new Position(0, 0), new Marker());
    world.spawn(new Position(1, 1));
    expect(world.has(tagged, Marker)).toBe(true);
    expect(world.query([Marker]).count()).toBe(1);
  });
});

describe('Required Components', () => {
  it('auto-inserts a single missing dependency', () => {
    const world = new World();
    const e = world.spawn(new Velocity(1, 0));
    expect(world.has(e, Position)).toBe(true);
    expect(world.getComponent(e, Position)).toEqual({ x: 0, y: 0 });
  });

  it('walks dependencies transitively', () => {
    class C {}
    class B {
      static requires: ComponentType[] = [C];
    }
    class A {
      static requires: ComponentType[] = [B];
    }
    const world = new World();
    const e = world.spawn(new A());
    expect(world.has(e, A)).toBe(true);
    expect(world.has(e, B)).toBe(true);
    expect(world.has(e, C)).toBe(true);
  });

  it('throws on cycles in the requires graph', () => {
    class A {
      static requires: ComponentType[] = [];
    }
    class B {
      static requires: ComponentType[] = [A];
    }
    A.requires = [B];
    const world = new World();
    expect(() => world.spawn(new A())).toThrow(/cycle/);
  });

  it('throws when a required dependency cannot be default-constructed', () => {
    class NeedsArg {
      constructor(public x: number) {
        if (x === undefined) throw new Error('x required');
      }
    }
    class HasReq {
      static requires: ComponentType[] = [NeedsArg];
    }
    const world = new World();
    expect(() => world.spawn(new HasReq())).toThrow(/not default-constructible/);
  });

  it('does not re-auto-insert a required dep that is already present on the entity', () => {
    const world = new World();
    const explicitPos = new Position(99, 99);
    const e = world.spawn(explicitPos);
    world.addComponent(e, Velocity, new Velocity(1, 0));
    expect(world.getComponent(e, Position)).toBe(explicitPos);
    expect(world.getComponent(e, Position)).toEqual({ x: 99, y: 99 });
  });
});

describe('Disabled marker and filter shapes', () => {
  it('default queries exclude entities carrying Disabled', () => {
    const world = new World();
    world.spawn(new Position(1, 1));
    const hidden = world.spawn(new Position(2, 2));
    world.entity(hidden).insert(new Disabled());
    expect(world.query([Position]).count()).toBe(1);
  });

  it('with: [Disabled] flips polarity and returns only disabled entities', () => {
    const world = new World();
    world.spawn(new Position(1, 1));
    const hidden = world.spawn(new Position(2, 2));
    world.entity(hidden).insert(new Disabled());
    const rows = [...world.query([Position], { with: [Disabled] })];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual([{ x: 2, y: 2 }]);
  });

  it('without: [T] excludes archetypes containing T', () => {
    const world = new World();
    world.spawn(new Position(1, 1));
    world.spawn(new Position(2, 2), new Marker());
    const rows = [...world.query([Position], { without: [Marker] })];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual([{ x: 1, y: 1 }]);
  });

  it('has: [T] appends a boolean per row in declaration order', () => {
    const world = new World();
    world.spawn(new Position(1, 1));
    world.spawn(new Position(2, 2), new Marker());
    const rows = [...world.query([Position], { has: [Marker] })];
    expect(rows).toHaveLength(2);
    const sorted = [...rows].sort((a, b) => (a[0] as Position).x - (b[0] as Position).x);
    expect(sorted[0]![1]).toBe(false);
    expect(sorted[1]![1]).toBe(true);
  });
});

describe('Query class identity from World', () => {
  it('World.query returns an iterable Query handle', () => {
    const world = new World();
    world.spawn(new Position(0, 0));
    const q = world.query([Position]);
    expect(q).toBeInstanceOf(Query);
    expect(typeof q[Symbol.iterator]).toBe('function');
  });
});

describe('Query.entries — yields entity id alongside row', () => {
  it('returns the same component values as the iterator, prefixed by the entity id', () => {
    const world = new World();
    const a = world.spawn(new Position(1, 2));
    const b = world.spawn(new Position(3, 4));
    const entries = [...world.query([Position]).entries()];
    expect(entries).toHaveLength(2);
    const byEntity = new Map(entries.map(([e, p]) => [e, p]));
    expect(byEntity.get(a)).toEqual({ x: 1, y: 2 });
    expect(byEntity.get(b)).toEqual({ x: 3, y: 4 });
  });

  it('respects without filter (Disabled is hidden by default)', () => {
    const world = new World();
    const visible = world.spawn(new Position(1, 1));
    const hidden = world.spawn(new Position(2, 2));
    world.entity(hidden).insert(new Disabled());
    const ids = [...world.query([Position]).entries()].map(([e]) => e);
    expect(ids).toEqual([visible]);
  });

  it('propagates the has-flag tail alongside the entity prefix', () => {
    const world = new World();
    const plain = world.spawn(new Position(1, 1));
    const tagged = world.spawn(new Position(2, 2), new Marker());
    const entries = [...world.query([Position], { has: [Marker] }).entries()];
    const byEntity = new Map(entries.map(([e, p, flag]) => [e, { p, flag }]));
    expect(byEntity.get(plain)!.flag).toBe(false);
    expect(byEntity.get(tagged)!.flag).toBe(true);
  });
});
