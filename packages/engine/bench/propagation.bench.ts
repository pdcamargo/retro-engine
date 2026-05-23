// Transform propagation — full recompute vs gated path, across three hierarchy
// shapes and dirty-set ratios. See docs/adr/ADR-0017.

import { bench, summary } from 'mitata';

import { type Entity, World } from '@retro-engine/ecs';

import {
  Children,
  GlobalTransform,
  Parent,
  Transform,
} from '@retro-engine/engine';
import {
  propagateTransforms,
  propagateTransformsGated,
} from '../src/hierarchy';

import { silentLogger } from './helpers';

interface HierarchyHandle {
  readonly world: World;
  readonly entities: readonly Entity[];
}

const spawnWithParent = (
  world: World,
  parent: Entity | undefined,
): Entity => {
  const e = parent !== undefined
    ? world.spawn(new Transform(), new GlobalTransform(), new Parent(parent))
    : world.spawn(new Transform(), new GlobalTransform());
  if (parent !== undefined) {
    const childrenList = world.getComponent(parent, Children);
    if (childrenList) childrenList.entities.push(e);
    else world.insertBundle(parent, [new Children([e])]);
  }
  return e;
};

const buildChain = (depth: number): HierarchyHandle => {
  const world = new World();
  const entities: Entity[] = [];
  let prev: Entity | undefined;
  for (let i = 0; i < depth; i += 1) {
    const e = spawnWithParent(world, prev);
    entities.push(e);
    prev = e;
  }
  return { world, entities };
};

const buildWide = (childCount: number): HierarchyHandle => {
  const world = new World();
  const entities: Entity[] = [];
  const root = spawnWithParent(world, undefined);
  entities.push(root);
  for (let i = 0; i < childCount; i += 1) {
    entities.push(spawnWithParent(world, root));
  }
  return { world, entities };
};

// 100 trees × ~100 nodes each. Each tree is itself a 10-wide × 10-levels chain:
// root → 1 child per level, but every fifth level branches into 2 children,
// giving an irregular but dense tree of ~100 nodes per root, ~10k total.
const buildForest = (trees: number, perTree: number): HierarchyHandle => {
  const world = new World();
  const entities: Entity[] = [];
  for (let t = 0; t < trees; t += 1) {
    const root = spawnWithParent(world, undefined);
    entities.push(root);
    let frontier: Entity[] = [root];
    while (entities.length < (t + 1) * perTree) {
      const next: Entity[] = [];
      for (const p of frontier) {
        const e1 = spawnWithParent(world, p);
        entities.push(e1);
        next.push(e1);
        if (entities.length >= (t + 1) * perTree) break;
        // Branch on alternate parents to widen.
        if (next.length % 3 === 0) {
          const e2 = spawnWithParent(world, p);
          entities.push(e2);
          next.push(e2);
          if (entities.length >= (t + 1) * perTree) break;
        }
      }
      if (next.length === 0) break;
      frontier = next;
    }
  }
  return { world, entities };
};

const markDirty = (h: HierarchyHandle, pct: number): void => {
  const target = Math.floor(h.entities.length * (pct / 100));
  for (let i = 0; i < target; i += 1) {
    h.world.markChanged(h.entities[i]!, Transform);
  }
};

interface Shape {
  readonly name: string;
  readonly build: () => HierarchyHandle;
}

const shapes: readonly Shape[] = [
  { name: 'chain-100', build: () => buildChain(100) },
  { name: 'wide-1k', build: () => buildWide(1_000) },
  { name: 'forest-10k', build: () => buildForest(100, 100) },
];

for (const shape of shapes) {
  summary(() => {
    bench(`propagateTransforms (full) @ ${shape.name}`, function* () {
      const h = shape.build();
      yield () => propagateTransforms(h.world, silentLogger);
    });

    bench(`propagateTransformsGated @ ${shape.name} @ 0% dirty`, function* () {
      const h = shape.build();
      // Drain the spawn-frame dirtiness so the gated path sees a truly idle frame.
      const ctInit = h.world.query([Transform], { changed: [Transform] }, 0);
      const cpInit = h.world.query([Parent], { changed: [Parent] }, 0);
      propagateTransformsGated(h.world, silentLogger, ctInit, cpInit, []);
      const snapshot = h.world.changeTick;
      const ct = h.world.query([Transform], { changed: [Transform] }, snapshot);
      const cp = h.world.query([Parent], { changed: [Parent] }, snapshot);
      yield () => propagateTransformsGated(h.world, silentLogger, ct, cp, []);
    });

    bench(`propagateTransformsGated @ ${shape.name} @ 10% dirty`, function* () {
      const h = shape.build();
      const ctInit = h.world.query([Transform], { changed: [Transform] }, 0);
      const cpInit = h.world.query([Parent], { changed: [Parent] }, 0);
      propagateTransformsGated(h.world, silentLogger, ctInit, cpInit, []);
      const snapshot = h.world.changeTick;
      markDirty(h, 10);
      const ct = h.world.query([Transform], { changed: [Transform] }, snapshot);
      const cp = h.world.query([Parent], { changed: [Parent] }, snapshot);
      yield () => propagateTransformsGated(h.world, silentLogger, ct, cp, []);
    });

    bench(`propagateTransformsGated @ ${shape.name} @ 100% dirty`, function* () {
      const h = shape.build();
      const ctInit = h.world.query([Transform], { changed: [Transform] }, 0);
      const cpInit = h.world.query([Parent], { changed: [Parent] }, 0);
      propagateTransformsGated(h.world, silentLogger, ctInit, cpInit, []);
      const snapshot = h.world.changeTick;
      markDirty(h, 100);
      const ct = h.world.query([Transform], { changed: [Transform] }, snapshot);
      const cp = h.world.query([Parent], { changed: [Parent] }, snapshot);
      yield () => propagateTransformsGated(h.world, silentLogger, ct, cp, []);
    });
  });
}
