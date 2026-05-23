// Commands flush throughput — spawn-only, insert-only, mixed workloads. The
// `advanceFrame` path is the realistic production driver; we measure the whole
// frame because that's what a game pays per tick.
// See docs/adr/ADR-0017.

import { bench, summary } from 'mitata';

import { App, Commands } from '@retro-engine/engine';
import { type Entity } from '@retro-engine/ecs';

import { makeHeadlessRenderer, silentLogger } from './helpers';

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
  bench('flush 10k spawn ops (1 cmp) via advanceFrame', function* () {
    yield () => {
      const app = new App({ renderer: makeHeadlessRenderer(), logger: silentLogger });
      app.addSystem('update', [Commands], (cmd) => {
        for (let i = 0; i < BATCH; i += 1) cmd.spawn(new Position(i, i));
      });
      app.advanceFrame(0);
    };
  });

  bench('flush 10k spawn ops (3 cmps) via advanceFrame', function* () {
    yield () => {
      const app = new App({ renderer: makeHeadlessRenderer(), logger: silentLogger });
      app.addSystem('update', [Commands], (cmd) => {
        for (let i = 0; i < BATCH; i += 1) {
          cmd.spawn(new Position(i, i), new Velocity(1, 0), new Health(100));
        }
      });
      app.advanceFrame(0);
    };
  });
});

summary(() => {
  bench('flush 10k insert ops on existing entities', function* () {
    yield () => {
      const app = new App({ renderer: makeHeadlessRenderer(), logger: silentLogger });
      // Pre-populate so the flush exercises the insert (not spawn) arm.
      const entities: Entity[] = [];
      for (let i = 0; i < BATCH; i += 1) entities.push(app.world.spawn(new Position(i, i)));
      app.addSystem('update', [Commands], (cmd) => {
        for (const e of entities) cmd.entity(e).insert(new Velocity(1, 0));
      });
      app.advanceFrame(0);
    };
  });

  bench('flush 10k remove ops on existing entities', function* () {
    yield () => {
      const app = new App({ renderer: makeHeadlessRenderer(), logger: silentLogger });
      const entities: Entity[] = [];
      for (let i = 0; i < BATCH; i += 1) {
        entities.push(app.world.spawn(new Position(i, i), new Velocity(1, 0)));
      }
      app.addSystem('update', [Commands], (cmd) => {
        for (const e of entities) cmd.entity(e).remove(Velocity);
      });
      app.advanceFrame(0);
    };
  });

  bench('flush 10k despawn ops on existing entities', function* () {
    yield () => {
      const app = new App({ renderer: makeHeadlessRenderer(), logger: silentLogger });
      const entities: Entity[] = [];
      for (let i = 0; i < BATCH; i += 1) entities.push(app.world.spawn(new Position(i, i)));
      app.addSystem('update', [Commands], (cmd) => {
        for (const e of entities) cmd.entity(e).despawn();
      });
      app.advanceFrame(0);
    };
  });
});

summary(() => {
  bench('flush mixed 10k ops (spawn + insert + remove + despawn)', function* () {
    yield () => {
      const app = new App({ renderer: makeHeadlessRenderer(), logger: silentLogger });
      const seed: Entity[] = [];
      for (let i = 0; i < BATCH; i += 1) {
        seed.push(app.world.spawn(new Position(i, i), new Velocity(1, 0)));
      }
      app.addSystem('update', [Commands], (cmd) => {
        for (let i = 0; i < BATCH; i += 1) {
          const e = seed[i]!;
          if (i % 4 === 0) cmd.entity(e).insert(new Health(50));
          else if (i % 4 === 1) cmd.entity(e).remove(Velocity);
          else if (i % 4 === 2) cmd.spawn(new Position(i, -i));
          else cmd.entity(e).despawn();
        }
      });
      app.advanceFrame(0);
    };
  });
});
