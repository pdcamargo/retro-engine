import { describe, expect, it } from 'bun:test';

import type { Entity } from '@retro-engine/ecs';

import {
  App,
  Commands,
  Query,
  RemovedComponents,
  RunCondition,
} from './index';

import { makeHeadlessRenderer } from './test-utils';

class Position {
  constructor(
    public x = 0,
    public y = 0,
  ) {}
}

class Velocity {
  constructor(public vx = 0) {}
}

class Health {
  constructor(public hp = 100) {}
}

class Marker {}

const advanceTwoFrames = (app: App): void => {
  app.advanceFrame(0);
  app.advanceFrame(16);
};

describe('Changed<T> via Query filter', () => {
  it('a system sees only entities whose component was mutated since its prior run', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });

    let observed: number[] = [];
    app.addSystem(
      'update',
      [Query([Position], { changed: [Position] })],
      (q) => {
        observed = [];
        for (const [pos] of q) observed.push(pos.x);
      },
    );

    const a = app.world.spawn(new Position(1, 1));
    const b = app.world.spawn(new Position(2, 2));

    // Frame 1: system runs for the first time — lastSeenTick = 0, so every
    // freshly-spawned row is "changed" since 0.
    app.advanceFrame(0);
    expect(new Set(observed)).toEqual(new Set([1, 2]));

    // Frame 2: no mutations occurred between the prior pre-run snapshot and
    // this run, so observed is empty.
    app.advanceFrame(16);
    expect(observed).toEqual([]);

    // Mutate a.Position, advance one more frame: the system observes only a.
    app.world.markChanged(a, Position);
    app.advanceFrame(32);
    expect(observed).toEqual([1]);

    // Mutate b.Position; system observes only b on the next frame.
    void a;
    void b;
    app.world.markChanged(b, Position);
    app.advanceFrame(48);
    expect(observed).toEqual([2]);
  });
});

describe('Added<T> via Query filter', () => {
  it('a system sees only entities whose component was newly attached since its prior run', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });

    let observed: number[] = [];
    app.addSystem('update', [Query([Position], { added: [Position] })], (q) => {
      observed = [];
      for (const [pos] of q) observed.push(pos.x);
    });

    app.world.spawn(new Position(1, 1));

    app.advanceFrame(0);
    expect(observed).toEqual([1]);

    // No additions next frame.
    app.advanceFrame(16);
    expect(observed).toEqual([]);

    // markChanged does NOT trigger Added.
    const e2 = app.world.spawn();
    app.world.insertBundle(e2, [new Position(99, 99)]);
    app.advanceFrame(32);
    expect(observed).toEqual([99]);

    app.world.markChanged(e2, Position);
    app.advanceFrame(48);
    expect(observed).toEqual([]);
  });
});

describe('Pre-run snapshot (Bevy-aligned) — system re-observes its own prior-frame mutations', () => {
  it('a system that spawns via Commands also observes the spawn via its own Added<T> filter on the next frame', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });

    let spawnedCount = 0;
    let observed: number[] = [];
    app.addSystem(
      'update',
      [Commands, Query([Position], { added: [Position] })],
      (cmd, q) => {
        if (spawnedCount === 0) {
          cmd.spawn(new Position(7, 7));
          spawnedCount += 1;
        }
        observed = [];
        for (const [pos] of q) observed.push(pos.x);
      },
    );

    // Frame 1: system runs. lastSeenTick = 0; Position hasn't been spawned
    // yet at param-resolve time, so observed is empty. The spawn happens
    // via Commands flush *after* the system body — bumping ticks. Crucially
    // the post-run record stores the *pre-run* snapshot (= 0 at first run),
    // so on frame 2 the system re-observes the now-present spawn.
    app.advanceFrame(0);
    expect(observed).toEqual([]);

    // Frame 2: param-resolve sees the spawned Position. lastSeenTick is 0
    // (pre-run snapshot from frame 1), so the row's addedTick (> 0) passes.
    app.advanceFrame(16);
    expect(observed).toEqual([7]);

    // Frame 3: pre-run snapshot from frame 2 was the world's tick before
    // any work happened in frame 2. The addedTick was earlier than that
    // snapshot, so frame 3's Added filter no longer matches the row.
    app.advanceFrame(32);
    expect(observed).toEqual([]);
  });
});

describe('Cross-frame accumulation under runIf', () => {
  it('a runIf-gated system that skips frames accumulates Changed observations across all skipped frames', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });

    let runFlag = false;
    const gate = new RunCondition(() => runFlag);

    let observed: number[] = [];
    app.addSystem(
      'update',
      [Query([Position], { changed: [Position] })],
      (q) => {
        observed = [];
        for (const [pos] of q) observed.push(pos.x);
      },
      { runIf: gate },
    );

    const a = app.world.spawn(new Position(1, 1));
    const b = app.world.spawn(new Position(2, 2));

    // System gated off for frames 1–3 while we mutate both entities.
    app.world.markChanged(a, Position);
    app.advanceFrame(0);
    expect(observed).toEqual([]);

    app.world.markChanged(b, Position);
    app.advanceFrame(16);
    expect(observed).toEqual([]);

    app.advanceFrame(32);
    expect(observed).toEqual([]);

    // Now let the system run. It sees BOTH a and b — every mutation since
    // the system's initial lastSeenTick (0) accumulated through.
    runFlag = true;
    app.advanceFrame(48);
    expect(new Set(observed)).toEqual(new Set([1, 2]));
  });
});

describe('RemovedComponents<T> param', () => {
  it('a system sees entities whose component was removed during the current frame', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });

    let observed: Entity[] = [];
    app.addSystem('postUpdate', [RemovedComponents(Position)], (gone) => {
      observed = [];
      for (const e of gone) observed.push(e);
    });

    const a = app.world.spawn(new Position(1, 1));
    const b = app.world.spawn(new Position(2, 2));

    app.advanceFrame(0);
    expect(observed).toEqual([]);

    app.world.removeComponent(a, Position);
    app.world.removeComponent(b, Position);
    app.advanceFrame(16);
    expect(new Set(observed)).toEqual(new Set([a, b]));

    // Frame 3: buffer was drained at end of frame 2; nothing new removed.
    app.advanceFrame(32);
    expect(observed).toEqual([]);
  });

  it('despawn pushes one RemovedComponents entry per component the entity carried', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });

    let posGone: Entity[] = [];
    let velGone: Entity[] = [];
    let healthGone: Entity[] = [];

    app.addSystem(
      'postUpdate',
      [
        RemovedComponents(Position),
        RemovedComponents(Velocity),
        RemovedComponents(Health),
      ],
      (p, v, h) => {
        posGone = [...p];
        velGone = [...v];
        healthGone = [...h];
      },
    );

    const e = app.world.spawn(new Position(1, 1), new Velocity(0), new Health(50));
    app.advanceFrame(0);
    expect(posGone).toEqual([]);

    app.world.despawn(e);
    app.advanceFrame(16);
    expect(posGone).toEqual([e]);
    expect(velGone).toEqual([e]);
    expect(healthGone).toEqual([e]);
  });

  it('frame-boundary drain: removals are not observable on the next frame', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });

    let observed: Entity[] = [];
    app.addSystem('last', [RemovedComponents(Marker)], (gone) => {
      observed = [];
      for (const e of gone) observed.push(e);
    });

    const e = app.world.spawn(new Marker());
    app.advanceFrame(0);

    app.world.removeComponent(e, Marker);
    app.advanceFrame(16);
    expect(observed).toEqual([e]);

    app.advanceFrame(32);
    expect(observed).toEqual([]);
  });

  it('all stages within a single frame observe the same removal', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });

    const observedByStage = new Map<string, Entity[]>();
    const record = (stage: string) => (gone: Iterable<Entity>) => {
      observedByStage.set(stage, [...gone]);
    };

    app.addSystem('update', [RemovedComponents(Marker)], record('update'));
    app.addSystem('postUpdate', [RemovedComponents(Marker)], record('postUpdate'));
    app.addSystem('last', [RemovedComponents(Marker)], record('last'));

    const e = app.world.spawn(new Marker());
    app.advanceFrame(0);

    app.world.removeComponent(e, Marker);
    app.advanceFrame(16);

    expect(observedByStage.get('update')).toEqual([e]);
    expect(observedByStage.get('postUpdate')).toEqual([e]);
    expect(observedByStage.get('last')).toEqual([e]);
  });
});

describe('Regression: non-change-filtered queries unaffected', () => {
  it('Query without changed/added filters yields every matching row every frame', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });

    let observed: number[] = [];
    app.addSystem('update', [Query([Position])], (q) => {
      observed = [];
      for (const [pos] of q) observed.push(pos.x);
    });

    app.world.spawn(new Position(1, 1));
    app.world.spawn(new Position(2, 2));

    advanceTwoFrames(app);
    expect(new Set(observed)).toEqual(new Set([1, 2]));
  });
});
