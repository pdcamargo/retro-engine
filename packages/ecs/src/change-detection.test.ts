import { describe, expect, it } from 'bun:test';

import { type ComponentType, World } from './index';

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

class Marker {}

const componentTypeRef = (ctor: unknown): ComponentType => ctor as ComponentType;

describe('World — change tick advances on every structural mutation', () => {
  it('spawn / insertBundle / removeComponent / despawn / markChanged each bump changeTick', () => {
    const world = new World();
    const base = world.changeTick;
    const e = world.spawn();
    const afterSpawn = world.changeTick;
    expect(afterSpawn).toBeGreaterThan(base);

    world.insertBundle(e, [new Position(1, 2)]);
    expect(world.changeTick).toBeGreaterThan(afterSpawn);
    const afterInsert = world.changeTick;

    world.markChanged(e, Position);
    expect(world.changeTick).toBeGreaterThan(afterInsert);
    const afterMark = world.changeTick;

    world.removeComponent(e, Position);
    expect(world.changeTick).toBeGreaterThan(afterMark);
    const afterRemove = world.changeTick;

    world.despawn(e);
    expect(world.changeTick).toBeGreaterThan(afterRemove);
  });
});

describe('Changed<T> filter — yields rows whose changedTick > sinceTick', () => {
  it('newly spawned rows are Changed since 0', () => {
    const world = new World();
    world.spawn(new Position(1, 1));
    world.spawn(new Position(2, 2));
    const rows = [...world.query([Position], { changed: [Position] }, 0)];
    expect(rows).toHaveLength(2);
  });

  it('after snapshot, untouched rows are not Changed', () => {
    const world = new World();
    world.spawn(new Position(1, 1));
    const snapshot = world.changeTick;
    const rows = [...world.query([Position], { changed: [Position] }, snapshot)];
    expect(rows).toHaveLength(0);
  });

  it('markChanged bumps a row back into the Changed window', () => {
    const world = new World();
    const a = world.spawn(new Position(1, 1));
    const b = world.spawn(new Position(2, 2));
    const snapshot = world.changeTick;
    world.markChanged(a, Position);

    const ids = new Set(
      [...world.query([Position], { changed: [Position] }, snapshot).entries()].map(
        ([e]) => e,
      ),
    );
    expect(ids.has(a)).toBe(true);
    expect(ids.has(b)).toBe(false);
  });

  it('in-place insertBundle (same archetype) bumps changedTick on every component in the bundle', () => {
    const world = new World();
    const a = world.spawn(new Position(1, 1));
    const b = world.spawn(new Position(2, 2));
    const snapshot = world.changeTick;
    world.insertBundle(a, [new Position(7, 7)]);

    const ids = new Set(
      [...world.query([Position], { changed: [Position] }, snapshot).entries()].map(
        ([e]) => e,
      ),
    );
    expect(ids.has(a)).toBe(true);
    expect(ids.has(b)).toBe(false);
  });

  it('archetype-transition insertBundle bumps changedTick for newly attached components only', () => {
    const world = new World();
    const a = world.spawn(new Position(1, 1));
    const snapshot = world.changeTick;
    world.insertBundle(a, [new Velocity(5, 0)]);

    const changedPos = [...world.query([Position], { changed: [Position] }, snapshot)];
    expect(changedPos).toHaveLength(0); // Position retained, no fresh changedTick.
    const changedVel = [...world.query([Velocity], { changed: [Velocity] }, snapshot)];
    expect(changedVel).toHaveLength(1); // Velocity newly attached.
  });

  it('archetype-transition insertBundle bumps changedTick on re-inserted components', () => {
    const world = new World();
    const a = world.spawn(new Position(1, 1));
    const snapshot = world.changeTick;
    // Re-insert Position AND attach Velocity in the same bundle — triggers a
    // transition (Velocity is new) and updates Position by value.
    world.insertBundle(a, [new Position(7, 7), new Velocity(5, 0)]);

    const changedPos = [...world.query([Position], { changed: [Position] }, snapshot)];
    expect(changedPos).toHaveLength(1);
  });

  it('multiple types in the filter AND together', () => {
    const world = new World();
    const a = world.spawn(new Position(1, 1), new Velocity(0, 0));
    const b = world.spawn(new Position(2, 2), new Velocity(0, 0));
    const snapshot = world.changeTick;
    world.markChanged(a, Position);
    world.markChanged(b, Velocity);

    // a's Position is changed; a's Velocity is not. b's Velocity is changed;
    // b's Position is not. Neither row passes "changed in BOTH P and V".
    const both = [
      ...world.query([Position, Velocity], { changed: [Position, Velocity] }, snapshot),
    ];
    expect(both).toHaveLength(0);

    world.markChanged(a, Velocity);
    const after = [
      ...world.query([Position, Velocity], { changed: [Position, Velocity] }, snapshot),
    ];
    expect(after).toHaveLength(1);
  });
});

describe('Added<T> filter — yields rows whose addedTick > sinceTick', () => {
  it('newly spawned rows are Added since 0', () => {
    const world = new World();
    world.spawn(new Position(1, 1));
    const rows = [...world.query([Position], { added: [Position] }, 0)];
    expect(rows).toHaveLength(1);
  });

  it('after snapshot, untouched rows are not Added', () => {
    const world = new World();
    world.spawn(new Position(1, 1));
    const snapshot = world.changeTick;
    const rows = [...world.query([Position], { added: [Position] }, snapshot)];
    expect(rows).toHaveLength(0);
  });

  it('markChanged does NOT bump addedTick — Added is distinct from Changed', () => {
    const world = new World();
    const a = world.spawn(new Position(1, 1));
    const snapshot = world.changeTick;
    world.markChanged(a, Position);

    const changed = [...world.query([Position], { changed: [Position] }, snapshot)];
    expect(changed).toHaveLength(1);
    const added = [...world.query([Position], { added: [Position] }, snapshot)];
    expect(added).toHaveLength(0);
  });

  it('in-place re-insertion does NOT bump addedTick (replace semantics)', () => {
    const world = new World();
    const a = world.spawn(new Position(1, 1));
    const snapshot = world.changeTick;
    world.insertBundle(a, [new Position(7, 7)]);

    const added = [...world.query([Position], { added: [Position] }, snapshot)];
    expect(added).toHaveLength(0);
    const changed = [...world.query([Position], { changed: [Position] }, snapshot)];
    expect(changed).toHaveLength(1);
  });

  it('archetype transition does NOT mark retained components as Added', () => {
    const world = new World();
    const a = world.spawn(new Position(1, 1));
    const snapshot = world.changeTick;
    world.insertBundle(a, [new Velocity(5, 0)]);

    const addedPos = [...world.query([Position], { added: [Position] }, snapshot)];
    expect(addedPos).toHaveLength(0); // Position retained across transition.
    const addedVel = [...world.query([Velocity], { added: [Velocity] }, snapshot)];
    expect(addedVel).toHaveLength(1); // Velocity newly attached.
  });

  it('Added implies Changed by construction', () => {
    const world = new World();
    world.spawn(new Position(1, 1));
    const added = new Set(
      [...world.query([Position], { added: [Position] }, 0).entries()].map(([e]) => e),
    );
    const changed = new Set(
      [...world.query([Position], { changed: [Position] }, 0).entries()].map(
        ([e]) => e,
      ),
    );
    for (const e of added) expect(changed.has(e)).toBe(true);
  });
});

describe('RemovedComponents buffer', () => {
  it('removeComponent pushes a RemovedEntry tagged with the current tick', () => {
    const world = new World();
    const e = world.spawn(new Position(1, 1));
    const snapshot = world.changeTick;
    world.removeComponent(e, Position);

    const removed = world.getRemovedComponents(Position);
    expect(removed).toHaveLength(1);
    expect(removed[0]!.entity).toBe(e);
    expect(removed[0]!.tick).toBeGreaterThan(snapshot);
  });

  it('despawn pushes one entry per component carried at despawn time', () => {
    const world = new World();
    const e = world.spawn(new Position(1, 1), new Velocity(0, 0), new Health(50));
    world.despawn(e);

    expect(world.getRemovedComponents(Position).map((r) => r.entity)).toEqual([e]);
    expect(world.getRemovedComponents(Velocity).map((r) => r.entity)).toEqual([e]);
    expect(world.getRemovedComponents(Health).map((r) => r.entity)).toEqual([e]);
  });

  it('drainRemovedBuffer clears every type', () => {
    const world = new World();
    const e = world.spawn(new Position(1, 1));
    world.despawn(e);
    expect(world.getRemovedComponents(Position)).toHaveLength(1);

    world.drainRemovedBuffer();
    expect(world.getRemovedComponents(Position)).toHaveLength(0);
  });

  it('removed entries from prior calls accumulate until drain', () => {
    const world = new World();
    const a = world.spawn(new Marker());
    const b = world.spawn(new Marker());
    world.removeComponent(a, Marker);
    world.removeComponent(b, Marker);

    const entries = world.getRemovedComponents(Marker);
    expect(entries.map((r) => r.entity).sort()).toEqual([a, b].sort());
  });
});

describe('markChanged — defensiveness', () => {
  it('silent no-op on an entity that does not carry the type', () => {
    const world = new World();
    const e = world.spawn(new Position(1, 1));
    const snapshot = world.changeTick;
    // Velocity is not on e.
    expect(() => world.markChanged(e, componentTypeRef(Velocity))).not.toThrow();
    // No tick advance, no spurious Changed entry.
    expect(world.changeTick).toBe(snapshot);
  });

  it('silent no-op on an unknown entity', () => {
    const world = new World();
    const snapshot = world.changeTick;
    expect(() => world.markChanged(9999 as never, Position)).not.toThrow();
    expect(world.changeTick).toBe(snapshot);
  });
});

describe('Default world.query (no sinceTick / no change filters) regression', () => {
  it('returns every matching row when no change filters are passed', () => {
    const world = new World();
    world.spawn(new Position(1, 1));
    world.spawn(new Position(2, 2));
    expect(world.query([Position]).count()).toBe(2);
  });

  it('sinceTick = 0 with change filter yields every newly-touched row', () => {
    const world = new World();
    world.spawn(new Position(1, 1));
    world.spawn(new Position(2, 2));
    expect(world.query([Position], { changed: [Position] }, 0).count()).toBe(2);
  });
});
