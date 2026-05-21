import { describe, expect, it } from 'bun:test';

import { World } from './index';

const Position = Symbol('Position');

interface PositionData {
  x: number;
  y: number;
}

describe('World (day-1 stub)', () => {
  it('spawns entities with unique ids', () => {
    const world = new World();
    const a = world.spawn();
    const b = world.spawn();
    expect(a).not.toBe(b);
  });

  it('attaches and reads components by type', () => {
    const world = new World();
    const e = world.spawn();
    world.addComponent<PositionData>(e, Position, { x: 1, y: 2 });
    expect(world.getComponent<PositionData>(e, Position)).toEqual({ x: 1, y: 2 });
    expect(world.has(e, Position)).toBe(true);
  });

  it('removes components and entities', () => {
    const world = new World();
    const e = world.spawn();
    world.addComponent<PositionData>(e, Position, { x: 0, y: 0 });
    world.removeComponent(e, Position);
    expect(world.has(e, Position)).toBe(false);
    world.despawn(e);
    expect([...world.entities()]).not.toContain(e);
  });
});
