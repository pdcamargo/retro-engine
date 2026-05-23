// Change-detection filter overhead — Changed<T> / Added<T> at varying
// changed-row ratios; markChanged throughput; RemovedComponents drain.
// See docs/adr/ADR-0017.

import { bench, summary } from 'mitata';

import { type Entity, World } from '@retro-engine/ecs';

class Position {
  constructor(
    public x = 0,
    public y = 0,
  ) {}
}

const SIZE = 100_000;

interface ChangedDetectionSetup {
  readonly world: World;
  readonly snapshot: number;
}

const buildChangedSetup = (changedRatio: number): ChangedDetectionSetup => {
  const world = new World();
  const entities: Entity[] = [];
  for (let i = 0; i < SIZE; i += 1) entities.push(world.spawn(new Position(i, i)));
  const snapshot = world.changeTick;
  const toMark = Math.floor(SIZE * changedRatio);
  for (let i = 0; i < toMark; i += 1) world.markChanged(entities[i]!, Position);
  return { world, snapshot };
};

summary(() => {
  bench('Changed<Position> filter @ $pct% changed (100k rows)', function* (state: { get(name: string): unknown }) {
    const pct = state.get('pct') as number;
    const { world, snapshot } = buildChangedSetup(pct / 100);
    yield () => {
      let n = 0;
      for (const _row of world.query([Position], { changed: [Position] }, snapshot)) n += 1;
      return n;
    };
  }).args('pct', [0, 1, 10, 100]);
});

summary(() => {
  bench('Added<Position> filter @ all-fresh (100k rows since 0)', function* () {
    const world = new World();
    for (let i = 0; i < SIZE; i += 1) world.spawn(new Position(i, i));
    yield () => {
      let n = 0;
      for (const _row of world.query([Position], { added: [Position] }, 0)) n += 1;
      return n;
    };
  });

  bench('Added<Position> filter @ none-since-snapshot (100k rows)', function* () {
    const world = new World();
    for (let i = 0; i < SIZE; i += 1) world.spawn(new Position(i, i));
    const snapshot = world.changeTick;
    yield () => {
      let n = 0;
      for (const _row of world.query([Position], { added: [Position] }, snapshot)) n += 1;
      return n;
    };
  });
});

summary(() => {
  bench('markChanged 10k entities', function* () {
    const world = new World();
    const entities: Entity[] = [];
    for (let i = 0; i < 10_000; i += 1) entities.push(world.spawn(new Position()));
    yield () => {
      for (const e of entities) world.markChanged(e, Position);
    };
  });
});

summary(() => {
  bench('drainRemovedBuffer after 10k despawns', function* () {
    yield () => {
      const world = new World();
      const entities: Entity[] = [];
      for (let i = 0; i < 10_000; i += 1) entities.push(world.spawn(new Position()));
      for (const e of entities) world.despawn(e);
      world.drainRemovedBuffer();
      return world;
    };
  });

  bench('getRemovedComponents after 10k removeComponent', function* () {
    yield () => {
      const world = new World();
      const entities: Entity[] = [];
      for (let i = 0; i < 10_000; i += 1) entities.push(world.spawn(new Position()));
      for (const e of entities) world.removeComponent(e, Position);
      return world.getRemovedComponents(Position).length;
    };
  });
});
