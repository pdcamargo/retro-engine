// Bench files exercise the hot paths the engine bills callers for at runtime;
// see docs/adr/ADR-0017 for the methodology and threshold rules.

import { bench, summary } from 'mitata';

import { type Entity, World } from '@retro-engine/ecs';

class Position {
  constructor(
    public x = 0,
    public y = 0,
  ) {}
}

class Velocity {
  constructor(
    public vx = 0,
    public vy = 0,
  ) {}
}

class Health {
  constructor(public hp = 100) {}
}

class TagA {}
class TagB {}
class TagC {}
class TagD {}
class TagE {}

const ARCH_TAGS = [TagA, TagB, TagC, TagD, TagE];

summary(() => {
  bench('query iter $size entities (1 cmp)', function* (state: { get(name: string): unknown }) {
    const size = state.get('size') as number;
    const world = new World();
    for (let i = 0; i < size; i += 1) world.spawn(new Position(i, i));
    const q = world.query([Position]);
    yield () => {
      let sum = 0;
      for (const [p] of q) sum += p.x;
      return sum;
    };
  }).args('size', [1_000, 10_000, 100_000]);
});

summary(() => {
  bench('query iter $size entities (3 cmps)', function* (state: { get(name: string): unknown }) {
    const size = state.get('size') as number;
    const world = new World();
    for (let i = 0; i < size; i += 1) {
      world.spawn(new Position(i, i), new Velocity(1, 0), new Health(100));
    }
    const q = world.query([Position, Velocity, Health]);
    yield () => {
      let sum = 0;
      for (const [p, v, h] of q) sum += p.x + v.vx + h.hp;
      return sum;
    };
  }).args('size', [1_000, 10_000, 100_000]);
});

summary(() => {
  bench('query iter 100k entities across 5 archetypes (1 cmp)', function* () {
    const world = new World();
    // 20k entities per archetype, every archetype carrying Position + a unique tag.
    const PER = 20_000;
    for (let arch = 0; arch < ARCH_TAGS.length; arch += 1) {
      const Tag = ARCH_TAGS[arch]!;
      for (let i = 0; i < PER; i += 1) {
        world.spawn(new Position(i, arch), new Tag());
      }
    }
    const q = world.query([Position]);
    yield () => {
      let sum = 0;
      for (const [p] of q) sum += p.x;
      return sum;
    };
  });

  bench('query iter 100k entities with-filter (1 of 5 archetypes)', function* () {
    const world = new World();
    const PER = 20_000;
    for (let arch = 0; arch < ARCH_TAGS.length; arch += 1) {
      const Tag = ARCH_TAGS[arch]!;
      for (let i = 0; i < PER; i += 1) {
        world.spawn(new Position(i, arch), new Tag());
      }
    }
    const q = world.query([Position], { with: [TagC] });
    yield () => {
      let sum = 0;
      for (const [p] of q) sum += p.x;
      return sum;
    };
  });

  bench('query iter 100k entities without-filter (4 of 5 archetypes)', function* () {
    const world = new World();
    const PER = 20_000;
    for (let arch = 0; arch < ARCH_TAGS.length; arch += 1) {
      const Tag = ARCH_TAGS[arch]!;
      for (let i = 0; i < PER; i += 1) {
        world.spawn(new Position(i, arch), new Tag());
      }
    }
    const q = world.query([Position], { without: [TagC] });
    yield () => {
      let sum = 0;
      for (const [p] of q) sum += p.x;
      return sum;
    };
  });
});

summary(() => {
  bench('query.count() 100k entities', function* () {
    const world = new World();
    const entities: Entity[] = [];
    for (let i = 0; i < 100_000; i += 1) entities.push(world.spawn(new Position()));
    const q = world.query([Position]);
    yield () => q.count();
  });

  bench('query full-iter 100k entities (no body)', function* () {
    const world = new World();
    for (let i = 0; i < 100_000; i += 1) world.spawn(new Position());
    const q = world.query([Position]);
    yield () => {
      let n = 0;
      for (const _row of q) n += 1;
      return n;
    };
  });
});
