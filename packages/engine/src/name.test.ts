import { describe, expect, it } from 'bun:test';

import { World } from '@retro-engine/ecs';

import { Name } from './name';

describe('Name — defaults', () => {
  it('default ctor yields an empty name', () => {
    expect(new Name().value).toBe('');
  });

  it('ctor accepts an explicit name', () => {
    expect(new Name('eye').value).toBe('eye');
  });
});

describe('Name — as a component', () => {
  it('round-trips: spawn with Name, query it back', () => {
    const world = new World();
    const e = world.spawn(new Name('eye'));

    expect(world.has(e, Name)).toBe(true);
    expect(world.getComponent(e, Name)?.value).toBe('eye');

    const rows = [...world.query([Name])];
    expect(rows.map(([n]) => n.value)).toEqual(['eye']);
  });

  it('is standalone — no required companions, pulls nothing else into the entity', () => {
    // Unlike Transform (which auto-attaches GlobalTransform via `requires`),
    // Name declares no required components, so a Name-only entity carries
    // exactly Name and nothing else.
    expect((Name as { requires?: unknown }).requires).toBeUndefined();

    const world = new World();
    const e = world.spawn(new Name('solo'));
    expect(world.componentTypesOf(e)).toEqual([Name]);
  });
});
