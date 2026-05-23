// Entity churn — spawn / despawn / insertBundle throughput on warm and
// archetype-transitioning paths. See docs/adr/ADR-0017.

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

const BATCH = 10_000;

summary(() => {
  bench('spawn 10k entities (1 cmp) into fresh world', function* () {
    yield () => {
      const world = new World();
      for (let i = 0; i < BATCH; i += 1) world.spawn(new Position(i, i));
      return world;
    };
  });

  bench('spawn 10k entities (3 cmps) into fresh world', function* () {
    yield () => {
      const world = new World();
      for (let i = 0; i < BATCH; i += 1) {
        world.spawn(new Position(i, i), new Velocity(1, 0), new Health(100));
      }
      return world;
    };
  });

  bench('spawn 10k entities (3 cmps, array form) into fresh world', function* () {
    yield () => {
      const world = new World();
      for (let i = 0; i < BATCH; i += 1) {
        world.spawn([new Position(i, i), new Velocity(1, 0), new Health(100)]);
      }
      return world;
    };
  });
});

summary(() => {
  bench('despawn 10k entities from a 10k-entity world', function* () {
    yield () => {
      const world = new World();
      const entities: Entity[] = [];
      for (let i = 0; i < BATCH; i += 1) entities.push(world.spawn(new Position()));
      for (const e of entities) world.despawn(e);
      return world;
    };
  });
});

summary(() => {
  bench('insertBundle in-place 10k entities (same archetype, 1 cmp)', function* () {
    yield () => {
      const world = new World();
      const entities: Entity[] = [];
      for (let i = 0; i < BATCH; i += 1) entities.push(world.spawn(new Position()));
      // Re-insert Position on every entity — bundle types already present → no
      // archetype transition, just a per-row column write.
      for (const e of entities) world.insertBundle(e, [new Position(7, 7)]);
      return world;
    };
  });

  bench('insertBundle with archetype transition 10k entities', function* () {
    yield () => {
      const world = new World();
      const entities: Entity[] = [];
      for (let i = 0; i < BATCH; i += 1) entities.push(world.spawn(new Position()));
      // Attaching Velocity for the first time forces a transition out of the
      // Position-only archetype into Position+Velocity.
      for (const e of entities) world.insertBundle(e, [new Velocity(1, 0)]);
      return world;
    };
  });
});

summary(() => {
  bench('removeComponent 10k entities (forces archetype transition)', function* () {
    yield () => {
      const world = new World();
      const entities: Entity[] = [];
      for (let i = 0; i < BATCH; i += 1) {
        entities.push(world.spawn(new Position(), new Velocity()));
      }
      for (const e of entities) world.removeComponent(e, Velocity);
      return world;
    };
  });
});
