import { describe, expect, it } from 'bun:test';

import { World } from '@retro-engine/ecs';
import { TypeRegistry } from '@retro-engine/reflect';

import { listComponents } from './component-list';

class Position {}
class Velocity {}
class RuntimeOnly {}

describe('listComponents', () => {
  const registry = new TypeRegistry();
  registry.registerComponent(Position, {}, { name: 'Position' });
  registry.registerComponent(Velocity, {}, { name: 'Velocity' });

  it('tags registered components serializable, unregistered ones derived', () => {
    const world = new World();
    const e = world.spawn(new Position(), new RuntimeOnly());
    const entries = listComponents(world, registry, e);
    expect(entries.find((c) => c.name === 'Position')).toEqual({ name: 'Position', serializable: true });
    expect(entries.find((c) => c.name === 'RuntimeOnly')).toEqual({ name: 'RuntimeOnly', serializable: false });
  });

  it('lists serializable components first, each group sorted by name', () => {
    const world = new World();
    const e = world.spawn(new Velocity(), new Position(), new RuntimeOnly());
    expect(listComponents(world, registry, e).map((c) => c.name)).toEqual(['Position', 'Velocity', 'RuntimeOnly']);
  });
});
