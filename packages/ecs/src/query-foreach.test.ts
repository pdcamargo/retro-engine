import { describe, expect, it } from 'bun:test';

import { type Entity, World } from './index';

class Position {
  constructor(
    public x = 0,
    public y = 0,
  ) {}
}
class Velocity {
  constructor(public vx = 0) {}
}
class Tag {}

describe('Query.forEach (non-allocating iteration)', () => {
  it('visits the same rows as entries(), in the same order', () => {
    const world = new World();
    for (let i = 0; i < 5; i++) world.spawn(new Position(i, i * 2), new Velocity(i));

    const fromEntries = [...world.query([Position, Velocity]).entries()].map(
      ([e, p, v]) => [e, (p as Position).x, (v as Velocity).vx] as const,
    );
    const fromForEach: Array<readonly [Entity, number, number]> = [];
    world.query([Position, Velocity]).forEach((entry) => {
      fromForEach.push([entry[0], (entry[1] as Position).x, (entry[2] as Velocity).vx]);
    });

    expect(fromForEach).toEqual(fromEntries as unknown as typeof fromForEach);
  });

  it('reuses one row buffer across rows (the tuple is transient)', () => {
    const world = new World();
    for (let i = 0; i < 3; i++) world.spawn(new Position(i));
    const seen: unknown[][] = [];
    world.query([Position]).forEach((entry) => {
      seen.push(entry as unknown as unknown[]);
    });
    // Retaining the tuple is a misuse — all retained refs are the same object,
    // proving no per-row allocation. (Read inside the callback instead.)
    expect(seen).toHaveLength(3);
    expect(seen[0]).toBe(seen[1]);
    expect(seen[1]).toBe(seen[2]);
  });

  it('honors with/without/has/changed filters identically to entries()', () => {
    const world = new World();
    const a = world.spawn(new Position(1), new Velocity(1));
    world.spawn(new Position(2)); // no Velocity
    world.spawn(new Position(3), new Velocity(3), new Tag());

    // without: [Tag] excludes the tagged entity; has: [Velocity] flags presence.
    const collect = (useForEach: boolean): Array<[Entity, boolean]> => {
      const out: Array<[Entity, boolean]> = [];
      const q = world.query([Position], { without: [Tag], has: [Velocity] });
      if (useForEach) q.forEach((entry) => out.push([entry[0], entry[2] as boolean]));
      else for (const entry of q.entries()) out.push([entry[0], entry[2] as boolean]);
      return out;
    };
    expect(collect(true)).toEqual(collect(false));

    // changed gate: only the row whose Position changed since the snapshot.
    const since = world.changeTick;
    world.getComponent(a, Position)!.x = 99;
    world.markChanged(a, Position);
    const changedForEach: Entity[] = [];
    world.query([Position], { changed: [Position] }, since).forEach((e) => changedForEach.push(e[0]));
    expect(changedForEach).toEqual([a]);
  });
});
