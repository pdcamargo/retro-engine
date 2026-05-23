import { describe, expect, it } from 'bun:test';

import {
  App,
  Camera2d,
  Extract,
  Query,
  RenderCtx,
  RenderSet,
} from './index';
import { makeHeadlessRenderer, makeRenderingRenderer, makeStubCanvas } from './test-utils';

class Position {
  constructor(
    public x = 0,
    public y = 0,
  ) {}
}

class ExtractedPosition {
  constructor(public x = 0) {}
}

class Marker {}

describe('App.renderWorld', () => {
  it('is a peer World instance distinct from app.world', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    expect(app.renderWorld).not.toBe(app.world);
    const e = app.renderWorld.spawn(new Marker());
    expect(app.world.hasEntity(e)).toBe(false);
    expect(app.renderWorld.hasEntity(e)).toBe(true);
  });

  it('keeps main-world spawns invisible to render-world queries and vice versa', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    app.world.spawn(new Position(1, 2));
    app.renderWorld.spawn(new Position(99, 99));
    expect(app.world.query([Position]).count()).toBe(1);
    expect(app.renderWorld.query([Position]).count()).toBe(1);
    const [mainPos] = app.world.query([Position]).first()!;
    const [renderPos] = app.renderWorld.query([Position]).first()!;
    expect(mainPos.x).toBe(1);
    expect(renderPos.x).toBe(99);
  });
});

describe('render-stage systems run against renderWorld by default', () => {
  it('a Query inside a render-stage system observes renderWorld, not app.world', async () => {
    const app = new App({ renderer: makeRenderingRenderer(), canvas: makeStubCanvas() });
    app.world.spawn(new Position(11, 11));
    let observed: number[] = [];
    app.addSystem('render', [Query([Position])], (q) => {
      observed = [];
      for (const [p] of q) observed.push(p.x);
    });
    await app.run();
    // Render-stage Query iterates renderWorld (auto-cleared at frame start
    // and never populated this frame), so the observed list is empty even
    // though app.world has a matching entity.
    expect(observed).toEqual([]);
  });
});

describe('Extract<P>', () => {
  it('swaps the resolved world to the main world inside render-stage systems', async () => {
    const app = new App({ renderer: makeRenderingRenderer(), canvas: makeStubCanvas() });
    app.world.spawn(new Position(7, 7));
    let observed: number[] = [];
    app.addSystem('render', [Extract(Query([Position]))], (q) => {
      observed = [];
      for (const [p] of q) observed.push(p.x);
    }, { set: RenderSet.Extract });
    await app.run();
    expect(observed).toEqual([7]);
  });

  it('preserves the inner param scope (Extract(RenderCtx) is still render-stage only)', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    expect(() =>
      app.addSystem('update', [Extract(RenderCtx)], () => undefined),
    ).toThrow(/scoped to stage 'render'/);
  });
});

describe('RenderSet ordering', () => {
  it('runs the six sub-sets in order Extract → Prepare → Queue → PhaseSort → Render → Cleanup', async () => {
    const app = new App({ renderer: makeRenderingRenderer(), canvas: makeStubCanvas() });
    app.world.spawn(...Camera2d());
    const trail: string[] = [];
    app.addSystem('render', [], () => trail.push('cleanup'), { set: RenderSet.Cleanup });
    app.addSystem('render', [], () => trail.push('render'), { set: RenderSet.Render });
    app.addSystem('render', [], () => trail.push('phaseSort'), { set: RenderSet.PhaseSort });
    app.addSystem('render', [], () => trail.push('queue'), { set: RenderSet.Queue });
    app.addSystem('render', [], () => trail.push('prepare'), { set: RenderSet.Prepare });
    app.addSystem('render', [], () => trail.push('extract'), { set: RenderSet.Extract });
    await app.run();
    expect(trail).toEqual(['extract', 'prepare', 'queue', 'phaseSort', 'render', 'cleanup']);
  });

  it('defaults to the Render set for render-stage systems with no explicit set', async () => {
    const app = new App({ renderer: makeRenderingRenderer(), canvas: makeStubCanvas() });
    app.world.spawn(...Camera2d());
    const trail: string[] = [];
    // No `set` option — defaults to RenderSet.Render. Backwards-compat path
    // the playground triangle relied on before ADR-0019.
    app.addSystem('render', [], () => trail.push('default'));
    app.addSystem('render', [], () => trail.push('extract'), { set: RenderSet.Extract });
    app.addSystem('render', [], () => trail.push('cleanup'), { set: RenderSet.Cleanup });
    await app.run();
    expect(trail).toEqual(['extract', 'default', 'cleanup']);
  });

  it('rejects the `set` option in non-render stages', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    expect(() =>
      app.addSystem('update', [], () => undefined, { set: RenderSet.Extract }),
    ).toThrow(/'set' option is only valid for the 'render' stage/);
  });
});

describe('RenderCtx scope', () => {
  it('resolves inside the Render set', async () => {
    const app = new App({ renderer: makeRenderingRenderer(), canvas: makeStubCanvas() });
    app.world.spawn(...Camera2d());
    let resolved = false;
    app.addSystem('render', [RenderCtx], (ctx) => {
      expect(ctx.pass).toBeDefined();
      expect(ctx.encoder).toBeDefined();
      resolved = true;
    }, { set: RenderSet.Render });
    await app.run();
    expect(resolved).toBe(true);
  });

  it('throws when resolved inside Extract / Prepare / Queue / PhaseSort / Cleanup', async () => {
    for (const set of [RenderSet.Extract, RenderSet.Prepare, RenderSet.Queue, RenderSet.PhaseSort, RenderSet.Cleanup]) {
      const app = new App({ renderer: makeRenderingRenderer(), canvas: makeStubCanvas() });
      app.addSystem('render', [RenderCtx], () => undefined, { set });
      await expect(app.run()).rejects.toThrow(/RenderCtx: no render context available/);
    }
  });
});

describe('Render-world auto-clear', () => {
  it('clears every render-world entity between frames', async () => {
    const app = new App({ renderer: makeRenderingRenderer(), canvas: makeStubCanvas() });
    app.world.spawn(...Camera2d());
    const renderCounts: number[] = [];
    app.addSystem('render', [], () => {
      app.renderWorld.spawn(new Marker(), new Position());
    }, { set: RenderSet.Extract });
    app.addSystem('render', [Query([Position])], (q) => {
      renderCounts.push(q.count());
    });

    await app.run();
    expect(renderCounts).toEqual([1]);
    expect(app.renderWorld.query([Position]).count()).toBe(1);

    // Run a second frame — the start-of-frame auto-clear wipes the previous
    // frame's entity, Extract re-spawns one, Render sees exactly one again.
    app.advanceFrame(16);
    expect(renderCounts).toEqual([1, 1]);
    // No leak: still exactly one entity in renderWorld, not two.
    expect(app.renderWorld.query([Position]).count()).toBe(1);
  });

  it('headless apps still run Extract / Cleanup sets so per-frame teardown fires', async () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const trail: string[] = [];
    app.addSystem('render', [], () => trail.push('extract'), { set: RenderSet.Extract });
    app.addSystem('render', [], () => trail.push('cleanup'), { set: RenderSet.Cleanup });
    // No canvas → no surface → the Render set is skipped, but pre/post
    // sets still run.
    await app.run();
    expect(trail).toEqual(['extract', 'cleanup']);
  });
});

describe('Extract round-trip integration', () => {
  it('copies a main-world entity into the render world each frame', async () => {
    const app = new App({ renderer: makeRenderingRenderer(), canvas: makeStubCanvas() });
    app.world.spawn(...Camera2d());
    app.world.spawn(new Position(3, 0));
    app.world.spawn(new Position(5, 0));

    app.addSystem(
      'render',
      [Extract(Query([Position]))],
      (q) => {
        for (const [p] of q) app.renderWorld.spawn(new ExtractedPosition(p.x));
      },
      { set: RenderSet.Extract },
    );

    let renderSeen: number[] = [];
    app.addSystem('render', [Query([ExtractedPosition])], (q) => {
      renderSeen = [];
      for (const [p] of q) renderSeen.push(p.x);
    });

    await app.run();
    expect(renderSeen.slice().sort((a, b) => a - b)).toEqual([3, 5]);

    // Mutate main world, advance another frame — extract should pick up the
    // change without leakage from the prior frame.
    app.world.spawn(new Position(7, 0));
    app.advanceFrame(16);
    expect(renderSeen.slice().sort((a, b) => a - b)).toEqual([3, 5, 7]);
  });
});
