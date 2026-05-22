import { describe, expect, it } from 'bun:test';

import type {
  CommandEncoder,
  Renderer,
  RendererCapabilities,
  RenderPipeline,
  ShaderModule,
  Surface,
  TextureFormat,
} from '@retro-engine/renderer-core';

import {
  anyWithComponent,
  App,
  inState,
  NextState,
  resourceChanged,
  resourceExists,
  ResMut,
} from './index';

const fail = (msg: string): never => {
  throw new Error(`stub renderer: ${msg} not implemented`);
};

const baseCapabilities: RendererCapabilities = {
  computeShaders: false,
  storageTextures: false,
  timestampQueries: false,
  indirectDraw: false,
  bgra8UnormStorage: false,
};

const makeHeadlessRenderer = (): Renderer => ({
  capabilities: baseCapabilities,
  init: () => Promise.resolve(),
  destroy: () => undefined,
  getPreferredSurfaceFormat: (): TextureFormat => 'rgba8unorm',
  createSurface: (): Surface => fail('createSurface'),
  createShaderModule: (): ShaderModule => fail('createShaderModule'),
  createRenderPipeline: (): RenderPipeline => fail('createRenderPipeline'),
  createCommandEncoder: (): CommandEncoder => fail('createCommandEncoder'),
  submit: (): void => fail('submit'),
});

class GameState {
  static readonly Boot = new GameState('Boot');
  static readonly Playing = new GameState('Playing');
  static readonly Paused = new GameState('Paused');
  constructor(public readonly name: string) {}
}

describe('inState', () => {
  it('returns true only while the current state equals the given value', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    app.initState(GameState, GameState.Boot);

    const samples: { stage: string; ran: boolean }[] = [];
    app.addSystem(
      'update',
      [],
      () => {
        samples.push({ stage: 'playing-gated', ran: true });
      },
      { runIf: inState(GameState.Playing) },
    );
    app.addSystem(
      'update',
      [],
      () => {
        samples.push({ stage: 'boot-gated', ran: true });
      },
      { runIf: inState(GameState.Boot) },
    );

    app.advanceFrame(0); // initial → Boot; in update we are now in Boot.
    expect(samples).toEqual([{ stage: 'boot-gated', ran: true }]);

    samples.length = 0;
    // Transition Boot → Playing.
    app.addSystem('preUpdate', [ResMut(NextState(GameState))], (next) => {
      next.set(GameState.Playing);
    });
    app.advanceFrame(16);
    expect(samples).toEqual([{ stage: 'playing-gated', ran: true }]);
  });

  it('returns false before initState has been called', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    let ran = 0;
    app.addSystem(
      'update',
      [],
      () => {
        ran += 1;
      },
      { runIf: inState(GameState.Boot) },
    );
    app.advanceFrame(0);
    expect(ran).toBe(0);
  });

  it('composes via RunCondition.and / .or / .not', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    app.initState(GameState, GameState.Boot);
    class Theme {}
    let andRan = 0;
    let orRan = 0;
    let notRan = 0;
    app.addSystem(
      'update',
      [],
      () => {
        andRan += 1;
      },
      { runIf: inState(GameState.Boot).and(resourceExists(Theme)) },
    );
    app.addSystem(
      'update',
      [],
      () => {
        orRan += 1;
      },
      { runIf: inState(GameState.Boot).or(inState(GameState.Playing)) },
    );
    app.addSystem(
      'update',
      [],
      () => {
        notRan += 1;
      },
      { runIf: inState(GameState.Boot).not() },
    );

    // Frame 1: Boot, no Theme — and=false, or=true, not=false.
    app.advanceFrame(0);
    expect(andRan).toBe(0);
    expect(orRan).toBe(1);
    expect(notRan).toBe(0);

    // Insert Theme — flips and condition.
    app.insertResource(new Theme());
    app.advanceFrame(16);
    expect(andRan).toBe(1);
    expect(orRan).toBe(2);
    expect(notRan).toBe(0);
  });
});

describe('resourceExists', () => {
  it('flips true once a matching resource is inserted', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    class Foo {}
    const trace: number[] = [];
    app.addSystem(
      'update',
      [],
      () => {
        trace.push(1);
      },
      { runIf: resourceExists(Foo) },
    );

    app.advanceFrame(0);
    expect(trace).toEqual([]);

    app.insertResource(new Foo());
    app.advanceFrame(16);
    expect(trace).toEqual([1]);

    app.removeResource(Foo);
    app.advanceFrame(32);
    expect(trace).toEqual([1]);
  });
});

describe('resourceChanged', () => {
  it('fires only on the frame the resource was inserted', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    class Foo {}
    let fired = 0;
    app.addSystem(
      'update',
      [],
      () => {
        fired += 1;
      },
      { runIf: resourceChanged(Foo) },
    );

    app.advanceFrame(0); // Foo not registered.
    expect(fired).toBe(0);

    // Insert Foo BETWEEN frames — change frame = current Time.frame (1 right
    // now, having ticked once). Next advanceFrame brings Time.frame to 2;
    // resourceChanged compares == Time.frame, so it does NOT fire then. Inserts
    // during a frame's `update` (after Time.tick) would fire that same frame.
    app.insertResource(new Foo());
    app.advanceFrame(16);
    // Inserted at frame-counter 1 (post-tick of frame 1); frame 2 advances to
    // 2 and the condition reads 1 !== 2 → false.
    expect(fired).toBe(0);

    // Insert again during a frame: a 'first'-stage system writes a fresh
    // instance, immediately followed by 'update' reading the condition.
    app.addSystem('first', [], () => {
      app.insertResource(new Foo());
    });
    app.advanceFrame(32);
    expect(fired).toBe(1);
    // Subsequent frames: no insert → no fire.
    app.removeResource(Foo);
    // Reinstall the resource so subsequent advanceFrames find it stable.
    app.insertResource(new Foo());
  });

  it('fires on the frame the resource was removed', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    class Foo {}
    let fired = 0;
    app.insertResource(new Foo());
    // Drive Time forward so the insertion's change-frame is in the past.
    app.advanceFrame(0);
    app.advanceFrame(16);

    app.addSystem(
      'last',
      [],
      () => {
        fired += 1;
      },
      { runIf: resourceChanged(Foo) },
    );
    // Remove during 'first', read condition during 'last' (same frame).
    app.addSystem('first', [], () => {
      app.removeResource(Foo);
    });
    app.advanceFrame(32);
    expect(fired).toBe(1);

    // Subsequent frame: no further change.
    app.advanceFrame(48);
    expect(fired).toBe(1);
  });

  it('does NOT fire on in-place mutations (documented v1 limitation)', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    class Counter {
      value = 0;
    }
    app.insertResource(new Counter());
    // Drive Time forward so the insertion's change frame is in the past.
    app.advanceFrame(0);
    app.advanceFrame(16);

    let fired = 0;
    app.addSystem(
      'last',
      [],
      () => {
        fired += 1;
      },
      { runIf: resourceChanged(Counter) },
    );
    // In-place mutation — not detected.
    app.addSystem('update', [ResMut(Counter)], (c) => {
      c.value += 1;
    });
    app.advanceFrame(32);
    app.advanceFrame(48);
    expect(fired).toBe(0);
  });
});

describe('anyWithComponent', () => {
  it('returns true while at least one entity carries the component', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    class Enemy {}

    let ran = 0;
    app.addSystem(
      'update',
      [],
      () => {
        ran += 1;
      },
      { runIf: anyWithComponent(Enemy) },
    );

    app.advanceFrame(0);
    expect(ran).toBe(0);

    const e = app.world.spawn(new Enemy());
    app.advanceFrame(16);
    expect(ran).toBe(1);

    app.world.despawn(e);
    app.advanceFrame(32);
    expect(ran).toBe(1);
  });
});
