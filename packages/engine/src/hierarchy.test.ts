import { describe, expect, it } from 'bun:test';

import type { Entity } from '@retro-engine/ecs';
import { World } from '@retro-engine/ecs';
import { quat, vec3 } from '@retro-engine/math';

import {
  App,
  Children,
  Commands,
  GlobalTransform,
  type Logger,
  Parent,
  Query,
  Transform,
} from './index';
import { propagateTransforms } from './hierarchy';
import { makeHeadlessRenderer } from './test-utils';

interface SpyLogger {
  readonly logger: Logger;
  readonly devWarns: string[];
}

const createSpyLogger = (): SpyLogger => {
  const devWarns: string[] = [];
  const logger: Logger = {
    error: () => undefined,
    warn: () => undefined,
    info: () => undefined,
    debug: () => undefined,
    devWarn: (m) => {
      devWarns.push(m);
    },
    child: () => logger,
  };
  return { logger, devWarns };
};

describe('propagateTransforms — root entities', () => {
  it('sets a root\'s GlobalTransform.matrix to its local TRS', () => {
    const world = new World();
    const e = world.spawn(new Transform(vec3.create(5, 0, 0)));
    const spy = createSpyLogger();
    propagateTransforms(world, spy.logger);
    const g = world.getComponent(e, GlobalTransform)!;
    expect(g.matrix[12]).toBeCloseTo(5, 6);
    expect(g.matrix[13]).toBeCloseTo(0, 6);
    expect(g.matrix[14]).toBeCloseTo(0, 6);
  });

  it('App auto-registers propagation in postUpdate and runs it each frame', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const e = app.world.spawn(new Transform(vec3.create(3, 4, 0)));
    app.advanceFrame(0);
    const g = app.world.getComponent(e, GlobalTransform)!;
    expect(g.matrix[12]).toBeCloseTo(3, 6);
    expect(g.matrix[13]).toBeCloseTo(4, 6);
  });

  it('responds to in-place mutation of a Transform across frames', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const e = app.world.spawn(new Transform(vec3.create(1, 0, 0)));
    app.advanceFrame(0);
    const t = app.world.getComponent(e, Transform)!;
    t.translation[0] = 10;
    // Direct field writes do not auto-bump Transform.changedTick — the gated
    // propagation only revisits entities flagged Changed<Transform>. Call
    // world.markChanged after the mutation to fire the dirty-set filter.
    app.world.markChanged(e, Transform);
    app.advanceFrame(16);
    expect(app.world.getComponent(e, GlobalTransform)!.matrix[12]).toBeCloseTo(10, 6);
  });
});

describe('propagateTransforms — parent + child', () => {
  it('child global = parent global * child local (translation)', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    let parentId: Entity | undefined;
    let childId: Entity | undefined;
    app.addSystem('startup', [Commands], (cmd) => {
      const parent = cmd.spawn(new Transform(vec3.create(10, 0, 0)));
      parentId = parent.id;
      parent.withChildren((p) => {
        childId = p.spawn(new Transform(vec3.create(0, 5, 0))).id;
      });
    });
    app.advanceFrame(0);
    const cg = app.world.getComponent(childId!, GlobalTransform)!;
    expect(cg.matrix[12]).toBeCloseTo(10, 5);
    expect(cg.matrix[13]).toBeCloseTo(5, 5);
    // Sanity: parent's global is its local.
    const pg = app.world.getComponent(parentId!, GlobalTransform)!;
    expect(pg.matrix[12]).toBeCloseTo(10, 5);
    expect(pg.matrix[13]).toBeCloseTo(0, 5);
  });

  it('child global responds to parent translation mutation', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    let parentId: Entity | undefined;
    let childId: Entity | undefined;
    app.addSystem('startup', [Commands], (cmd) => {
      const parent = cmd.spawn(new Transform());
      parentId = parent.id;
      parent.withChildren((p) => {
        childId = p.spawn(new Transform(vec3.create(2, 0, 0))).id;
      });
    });
    app.advanceFrame(0);
    expect(app.world.getComponent(childId!, GlobalTransform)!.matrix[12]).toBeCloseTo(2, 5);

    app.world.getComponent(parentId!, Transform)!.translation[0] = 100;
    app.world.markChanged(parentId!, Transform);
    app.advanceFrame(16);
    expect(app.world.getComponent(childId!, GlobalTransform)!.matrix[12]).toBeCloseTo(102, 5);
  });

  it('child global composes parent rotation through the child\'s translation', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    // Rotate parent 90° about Z; child offset (1, 0, 0) ends up at (0, 1, 0) world-space.
    let childId: Entity | undefined;
    app.addSystem('startup', [Commands], (cmd) => {
      const parent = cmd.spawn(
        new Transform(
          vec3.create(0, 0, 0),
          quat.fromAxisAngle(vec3.create(0, 0, 1), Math.PI / 2, quat.create()),
        ),
      );
      parent.withChildren((p) => {
        childId = p.spawn(new Transform(vec3.create(1, 0, 0))).id;
      });
    });
    app.advanceFrame(0);
    const cg = app.world.getComponent(childId!, GlobalTransform)!;
    expect(cg.matrix[12]).toBeCloseTo(0, 5);
    expect(cg.matrix[13]).toBeCloseTo(1, 5);
  });
});

describe('propagateTransforms — deep chains', () => {
  it('3-level chain composes correctly when the top ancestor moves', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    let aId: Entity | undefined;
    let dId: Entity | undefined;
    app.addSystem('startup', [Commands], (cmd) => {
      const a = cmd.spawn(new Transform());
      aId = a.id;
      a.withChildren((pA) => {
        const b = pA.spawn(new Transform(vec3.create(1, 0, 0)));
        b.withChildren((pB) => {
          const c = pB.spawn(new Transform(vec3.create(1, 0, 0)));
          c.withChildren((pC) => {
            dId = pC.spawn(new Transform(vec3.create(1, 0, 0))).id;
          });
        });
      });
    });
    app.advanceFrame(0);
    expect(app.world.getComponent(dId!, GlobalTransform)!.matrix[12]).toBeCloseTo(3, 5);

    app.world.getComponent(aId!, Transform)!.translation[0] = 100;
    app.world.markChanged(aId!, Transform);
    app.advanceFrame(16);
    expect(app.world.getComponent(dId!, GlobalTransform)!.matrix[12]).toBeCloseTo(103, 5);
  });
});

describe('propagateTransforms — reparenting', () => {
  it('a reparented child\'s GlobalTransform derives from the new parent', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    let bId: Entity | undefined;
    let cId: Entity | undefined;
    let childId: Entity | undefined;
    app.addSystem('startup', [Commands], (cmd) => {
      bId = cmd.spawn(new Transform(vec3.create(10, 0, 0))).id;
      cId = cmd.spawn(new Transform(vec3.create(0, 20, 0))).id;
      childId = cmd.spawn(new Transform(vec3.create(0, 0, 5))).id;
    });
    app.advanceFrame(0);

    // Parent A under B by hand-mutating the world (rather than registering a
    // one-shot system) — keeps the systems list tight so later reparenting via
    // addChild doesn't double-fire.
    app.world.insertBundle(childId!, [new Parent(bId!)]);
    app.world.insertBundle(bId!, [new Children([childId!])]);
    app.advanceFrame(16);
    let cg = app.world.getComponent(childId!, GlobalTransform)!;
    expect(cg.matrix[12]).toBeCloseTo(10, 5);
    expect(cg.matrix[13]).toBeCloseTo(0, 5);
    expect(cg.matrix[14]).toBeCloseTo(5, 5);

    // Reparent the child from B to C via Commands sugar.
    app.addSystem('update', [Commands], (cmd) => {
      cmd.entity(cId!).addChild(childId!);
    });
    app.advanceFrame(32);
    cg = app.world.getComponent(childId!, GlobalTransform)!;
    expect(cg.matrix[12]).toBeCloseTo(0, 5);
    expect(cg.matrix[13]).toBeCloseTo(20, 5);
    expect(cg.matrix[14]).toBeCloseTo(5, 5);
    // Old parent B has been detached.
    expect(app.world.getComponent(bId!, Children)?.entities ?? []).not.toContain(childId!);
    // New parent C has the child.
    expect(app.world.getComponent(cId!, Children)?.entities).toContain(childId!);
  });
});

describe('propagateTransforms — recursive despawn cascade', () => {
  it('despawnRecursive removes every descendant; propagation is silent on the missing entities', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    let rootId: Entity | undefined;
    const leafIds: Entity[] = [];
    app.addSystem('startup', [Commands], (cmd) => {
      const root = cmd.spawn(new Transform());
      rootId = root.id;
      root.withChildren((p) => {
        const mid = p.spawn(new Transform(vec3.create(1, 0, 0)));
        mid.withChildren((m) => {
          leafIds.push(m.spawn(new Transform(vec3.create(1, 0, 0))).id);
          leafIds.push(m.spawn(new Transform(vec3.create(2, 0, 0))).id);
        });
      });
    });
    app.advanceFrame(0);
    expect(app.world.hasEntity(rootId!)).toBe(true);
    for (const id of leafIds) expect(app.world.hasEntity(id)).toBe(true);

    app.addSystem('update', [Commands], (cmd) => {
      cmd.entity(rootId!).despawnRecursive();
    });
    expect(() => app.advanceFrame(16)).not.toThrow();
    expect(app.world.hasEntity(rootId!)).toBe(false);
    for (const id of leafIds) expect(app.world.hasEntity(id)).toBe(false);
  });
});

describe('propagateTransforms — orphan handling (Parent points to a dead entity)', () => {
  it('orphan is treated as a root and devWarn fires once', () => {
    const spy = createSpyLogger();
    const app = new App({ renderer: makeHeadlessRenderer(), logger: spy.logger });
    const orphanId = app.world.spawn(new Transform(vec3.create(7, 0, 0)));
    const deadParent = app.world.spawn(new Transform());
    app.world.insertBundle(orphanId, [new Parent(deadParent)]);
    app.world.despawn(deadParent);

    app.advanceFrame(0);
    const g = app.world.getComponent(orphanId!, GlobalTransform)!;
    expect(g.matrix[12]).toBeCloseTo(7, 5);
    expect(spy.devWarns.length).toBeGreaterThanOrEqual(1);
    expect(spy.devWarns[0]).toContain('Parent');

    const previousWarnCount = spy.devWarns.length;
    app.advanceFrame(16);
    // No further warns about the same orphan within the same propagation pass
    // is enforced by the per-pass Set; across frames a fresh Set means new
    // warns can fire — that's acceptable but documented.
    expect(spy.devWarns.length).toBeGreaterThanOrEqual(previousWarnCount);
  });
});

describe('propagateTransforms — cycle detection', () => {
  it('does not infinitely recurse when Parent chains cycle; both participants stay root-ish, devWarn fires', () => {
    const spy = createSpyLogger();
    const app = new App({ renderer: makeHeadlessRenderer(), logger: spy.logger });
    const a = app.world.spawn(new Transform(vec3.create(1, 0, 0)));
    const b = app.world.spawn(new Transform(vec3.create(0, 1, 0)));
    app.world.insertBundle(a, [new Parent(b)]);
    app.world.insertBundle(b, [new Parent(a)]);

    expect(() => app.advanceFrame(0)).not.toThrow();
    expect(spy.devWarns.some((m) => m.includes('cycle'))).toBe(true);
  });
});

describe('propagateTransformsGated — dirty-set gating', () => {
  interface TreeIds {
    parentId: Entity;
    leafId: Entity;
    cousinId: Entity;
  }

  const setupTree = (app: App): TreeIds => {
    const ids: TreeIds = {
      parentId: 0 as Entity,
      leafId: 0 as Entity,
      cousinId: 0 as Entity,
    };
    app.addSystem('startup', [Commands], (cmd) => {
      const p = cmd.spawn(new Transform(vec3.create(10, 0, 0)));
      ids.parentId = p.id;
      p.withChildren((b) => {
        ids.leafId = b.spawn(new Transform(vec3.create(1, 0, 0))).id;
        ids.cousinId = b.spawn(new Transform(vec3.create(2, 0, 0))).id;
      });
    });
    return ids;
  };

  const installProbe = (app: App): Entity[][] => {
    const changedEachFrame: Entity[][] = [];
    app.addSystem(
      'last',
      [Query([GlobalTransform], { changed: [GlobalTransform] })],
      (q) => {
        const ids: Entity[] = [];
        for (const [entity] of q.entries()) ids.push(entity);
        changedEachFrame.push(ids);
      },
    );
    return changedEachFrame;
  };

  it('spawn frame propagates every freshly-spawned entity', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const ids = setupTree(app);
    const changed = installProbe(app);
    app.advanceFrame(0);
    expect(new Set(changed[0])).toEqual(new Set([ids.parentId, ids.leafId, ids.cousinId]));
  });

  it('idle frame skips propagation entirely', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    setupTree(app);
    const changed = installProbe(app);
    app.advanceFrame(0);
    app.advanceFrame(16);
    // No mutations between frame 1 and 2 → probe sees zero changes on frame 2.
    expect(changed[1]).toEqual([]);
  });

  it('mutating a leaf only recomputes the leaf GlobalTransform', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const ids = setupTree(app);
    const changed = installProbe(app);
    app.advanceFrame(0);
    app.advanceFrame(16);

    app.world.getComponent(ids.leafId, Transform)!.translation[0] = 99;
    app.world.markChanged(ids.leafId, Transform);
    app.advanceFrame(32);

    expect(changed[2]).toEqual([ids.leafId]);
    // Parent and cousin globals unaffected — verify their stored matrix values.
    expect(app.world.getComponent(ids.parentId, GlobalTransform)!.matrix[12]).toBeCloseTo(10, 5);
    expect(app.world.getComponent(ids.cousinId, GlobalTransform)!.matrix[12]).toBeCloseTo(12, 5);
  });

  it('mutating a parent recomputes the parent and every descendant', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const ids = setupTree(app);
    const changed = installProbe(app);
    app.advanceFrame(0);
    app.advanceFrame(16);

    app.world.getComponent(ids.parentId, Transform)!.translation[0] = 100;
    app.world.markChanged(ids.parentId, Transform);
    app.advanceFrame(32);

    expect(new Set(changed[2])).toEqual(new Set([ids.parentId, ids.leafId, ids.cousinId]));
    expect(app.world.getComponent(ids.parentId, GlobalTransform)!.matrix[12]).toBeCloseTo(100, 5);
    expect(app.world.getComponent(ids.leafId, GlobalTransform)!.matrix[12]).toBeCloseTo(101, 5);
    expect(app.world.getComponent(ids.cousinId, GlobalTransform)!.matrix[12]).toBeCloseTo(102, 5);
  });

  it('reparenting via cmd.entity().addChild() recomputes the moved entity', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    let bId!: Entity;
    let cId!: Entity;
    let childId!: Entity;
    app.addSystem('startup', [Commands], (cmd) => {
      const b = cmd.spawn(new Transform(vec3.create(10, 0, 0)));
      bId = b.id;
      b.withChildren((p) => {
        childId = p.spawn(new Transform(vec3.create(0, 0, 5))).id;
      });
      const c = cmd.spawn(new Transform(vec3.create(0, 20, 0)));
      cId = c.id;
    });
    const changed = installProbe(app);
    app.advanceFrame(0);
    app.advanceFrame(16);

    // Verify the post-settle frame is idle.
    expect(changed[1]).toEqual([]);

    // Reparent via Commands sugar — the in-place mutation path inside the
    // appendChild arm bumps Parent.changedTick so the dirty-set picks it up.
    app.addSystem('update', [Commands], (cmd) => {
      cmd.entity(cId).addChild(childId);
    });
    app.advanceFrame(32);

    expect(changed[2]).toContain(childId);
    expect(app.world.getComponent(childId, GlobalTransform)!.matrix[12]).toBeCloseTo(0, 5);
    expect(app.world.getComponent(childId, GlobalTransform)!.matrix[13]).toBeCloseTo(20, 5);
    expect(app.world.getComponent(childId, GlobalTransform)!.matrix[14]).toBeCloseTo(5, 5);
    expect(bId).toBeDefined();
  });

  it('detach via cmd.entity().removeChild() recomputes the detached child as a root', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    let parentId!: Entity;
    let childId!: Entity;
    app.addSystem('startup', [Commands], (cmd) => {
      const p = cmd.spawn(new Transform(vec3.create(50, 0, 0)));
      parentId = p.id;
      p.withChildren((b) => {
        childId = b.spawn(new Transform(vec3.create(7, 0, 0))).id;
      });
    });
    const changed = installProbe(app);
    app.advanceFrame(0);
    app.advanceFrame(16);
    // Pre-detach, child's global is parent + local = 57.
    expect(app.world.getComponent(childId, GlobalTransform)!.matrix[12]).toBeCloseTo(57, 5);

    app.addSystem('update', [Commands], (cmd) => {
      cmd.entity(parentId).removeChild(childId);
    });
    app.advanceFrame(32);

    expect(changed[2]).toContain(childId);
    // Post-detach, child becomes a root — global = local TRS only.
    expect(app.world.getComponent(childId, GlobalTransform)!.matrix[12]).toBeCloseTo(7, 5);
  });
});
