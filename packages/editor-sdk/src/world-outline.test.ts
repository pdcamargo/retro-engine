import { describe, expect, it } from 'bun:test';

import { World } from '@retro-engine/ecs';
import { Name, Parent } from '@retro-engine/engine';

import { buildOutline, type EntityClassifier } from './world-outline';

describe('buildOutline', () => {
  const makeTree = (): { world: World; root: ReturnType<World['spawn']>; childA: ReturnType<World['spawn']> } => {
    const world = new World();
    const root = world.spawn(new Name('Root'));
    const childA = world.spawn(new Name('A'), new Parent(root));
    world.spawn(new Name('B'), new Parent(root));
    world.spawn(new Name('GC'), new Parent(childA));
    return { world, root, childA };
  };

  it('flattens roots → children depth-first, ordered by id', () => {
    const { world } = makeTree();
    const nodes = buildOutline(world);
    expect(nodes.map((n) => n.name)).toEqual(['Root', 'A', 'GC', 'B']);
    expect(nodes.map((n) => n.depth)).toEqual([0, 1, 2, 1]);
  });

  it('reports hasChildren per node', () => {
    const { world } = makeTree();
    const byName = new Map(buildOutline(world).map((n) => [n.name, n]));
    expect(byName.get('Root')!.hasChildren).toBe(true);
    expect(byName.get('A')!.hasChildren).toBe(true);
    expect(byName.get('B')!.hasChildren).toBe(false);
  });

  it('omits children of a collapsed entity', () => {
    const { world, childA } = makeTree();
    const nodes = buildOutline(world, { isOpen: (e) => e !== childA });
    expect(nodes.map((n) => n.name)).toEqual(['Root', 'A', 'B']);
  });

  it('prunes a skipped entity and its subtree', () => {
    const { world, childA } = makeTree();
    const nodes = buildOutline(world, { skip: (e) => e === childA });
    expect(nodes.map((n) => n.name)).toEqual(['Root', 'B']);
  });

  it('falls back to "Entity <id>" when there is no Name', () => {
    const world = new World();
    world.spawn();
    expect(buildOutline(world)[0]!.name).toMatch(/^Entity \d+$/);
  });

  it('classifies via the first matching classifier, else the default', () => {
    const { world, root } = makeTree();
    const custom: EntityClassifier = (_w, e) => (e === root ? { icon: 'box', kind: 'custom' } : undefined);
    const nodes = buildOutline(world, { classifiers: [custom] });
    expect(nodes[0]!.class.kind).toBe('custom');
    expect(nodes[1]!.class.kind).toBe('entity');
  });
});
