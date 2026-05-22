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

import { App, NextState, RenderCtx, Res, ResMut, State } from './index';

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
  static readonly MainMenu = new GameState('MainMenu');
  static readonly Playing = new GameState('Playing');
  static readonly Paused = new GameState('Paused');
  constructor(public readonly name: string) {}
}

class MenuState {
  static readonly Closed = new MenuState('Closed');
  static readonly Open = new MenuState('Open');
  constructor(public readonly name: string) {}
}

describe('State / NextState factories', () => {
  it('cache the minted class per state type', () => {
    expect(State(GameState)).toBe(State(GameState));
    expect(NextState(GameState)).toBe(NextState(GameState));
    expect(State(GameState)).not.toBe(NextState(GameState) as unknown);
    expect(State(GameState)).not.toBe(State(MenuState) as unknown);
  });
});

describe('App.initState', () => {
  it('inserts State and NextState resources keyed off the minted classes', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    app.initState(GameState, GameState.Boot);

    const state = app.getResource(State(GameState));
    const next = app.getResource(NextState(GameState));
    expect(state).toBeDefined();
    expect(next).toBeDefined();
    // Pre first-frame: current is undefined (initial OnEnter has not fired yet),
    // and NextState carries the initial value pending.
    expect(state?.current).toBeUndefined();
    expect(next?.value).toBe(GameState.Boot);
  });

  it('rejects values whose constructor does not match the state type', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    class Other {}
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      app.initState(GameState, new Other() as any),
    ).toThrow(/initial value's constructor.*does not match state type/);
  });

  it('rejects double-initialisation of the same state type', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    app.initState(GameState, GameState.Boot);
    expect(() => app.initState(GameState, GameState.Playing)).toThrow(/already initialised/);
  });
});

describe('StateTransition driver', () => {
  it('fires OnEnter(initial) on the first frame with no OnExit / OnTransition', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const trace: string[] = [];
    app.initState(GameState, GameState.Boot);
    app.onExit(GameState.Boot, [], () => trace.push('onExit-Boot'));
    app.onTransition(GameState.Boot, GameState.Boot, [], () => trace.push('onTransition-Boot-Boot'));
    app.onEnter(GameState.Boot, [], () => trace.push('onEnter-Boot'));

    app.advanceFrame(0);
    expect(trace).toEqual(['onEnter-Boot']);
    expect(app.getResource(State(GameState))?.current).toBe(GameState.Boot);
    expect(app.getResource(NextState(GameState))?.value).toBeUndefined();
  });

  it('fires OnExit → OnTransition → OnEnter in order on a transition', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const trace: string[] = [];
    app.initState(GameState, GameState.Boot);
    app.onExit(GameState.Boot, [], () => trace.push('exit-Boot'));
    app.onTransition(GameState.Boot, GameState.Playing, [], () =>
      trace.push('transition-Boot-Playing'),
    );
    app.onEnter(GameState.Playing, [], () => trace.push('enter-Playing'));

    // Frame 1: initial transition → OnEnter(Boot).
    app.advanceFrame(0);
    expect(trace).toEqual([]); // No OnEnter(Boot) registered above.

    // Schedule transition Boot → Playing, then advance one frame.
    app.addSystem('preUpdate', [ResMut(NextState(GameState))], (next) => {
      if (app.getResource(State(GameState))?.current === GameState.Boot) {
        next.set(GameState.Playing);
      }
    });
    app.advanceFrame(16);
    expect(trace).toEqual(['exit-Boot', 'transition-Boot-Playing', 'enter-Playing']);
    expect(app.getResource(State(GameState))?.current).toBe(GameState.Playing);
  });

  it('last-write-wins when NextState.set is called multiple times in one frame', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const enters: string[] = [];
    app.initState(GameState, GameState.Boot);
    app.onEnter(GameState.MainMenu, [], () => enters.push('MainMenu'));
    app.onEnter(GameState.Playing, [], () => enters.push('Playing'));
    app.onEnter(GameState.Paused, [], () => enters.push('Paused'));

    // First frame fires initial OnEnter(Boot) — no registration for Boot.
    app.advanceFrame(0);
    expect(enters).toEqual([]);

    // Frame 2: three sets in one frame → only Paused applies.
    app.addSystem('preUpdate', [ResMut(NextState(GameState))], (next) => {
      next.set(GameState.MainMenu);
      next.set(GameState.Playing);
      next.set(GameState.Paused);
    });
    app.advanceFrame(16);
    expect(enters).toEqual(['Paused']);
  });

  it('Res(State(S)) sees the live current value, including after a same-frame transition', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    app.initState(GameState, GameState.Boot);

    const seen: { preUpdate?: GameState; update?: GameState } = {};
    // preUpdate runs BEFORE StateTransition — sees old current (undefined on frame 1).
    app.addSystem('preUpdate', [Res(State(GameState))], (s) => {
      if (s.current !== undefined) seen.preUpdate = s.current;
    });
    // update runs AFTER StateTransition — sees post-transition current (Boot on frame 1).
    app.addSystem('update', [Res(State(GameState))], (s) => {
      if (s.current !== undefined) seen.update = s.current;
    });

    app.advanceFrame(0);
    expect(seen.preUpdate).toBeUndefined();
    expect(seen.update).toBe(GameState.Boot);
  });

  it('OnTransition is only invoked for the exact (from, to) pair', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const trace: string[] = [];
    app.initState(GameState, GameState.Boot);
    app.onTransition(GameState.Boot, GameState.MainMenu, [], () => trace.push('Boot-MainMenu'));
    app.onTransition(GameState.Boot, GameState.Playing, [], () => trace.push('Boot-Playing'));

    // Initial transition → OnEnter(Boot). No OnTransition registered for it.
    app.advanceFrame(0);
    expect(trace).toEqual([]);

    // Boot → Playing: only Boot-Playing fires.
    app.addSystem('preUpdate', [ResMut(NextState(GameState))], (next) => {
      const cur = app.getResource(State(GameState))?.current;
      if (cur === GameState.Boot) next.set(GameState.Playing);
    });
    app.advanceFrame(16);
    expect(trace).toEqual(['Boot-Playing']);
  });

  it('handles multiple state types independently in the same frame', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const trace: string[] = [];
    app.initState(GameState, GameState.Boot);
    app.initState(MenuState, MenuState.Closed);
    app.onEnter(GameState.Boot, [], () => trace.push('GameState.Boot'));
    app.onEnter(MenuState.Closed, [], () => trace.push('MenuState.Closed'));

    app.advanceFrame(0);
    // Both initial transitions fire on the same frame, in initState registration order.
    expect(trace).toEqual(['GameState.Boot', 'MenuState.Closed']);
  });

  it('rejects stage-scoped params (e.g. RenderCtx) in OnEnter / OnExit / OnTransition', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    app.initState(GameState, GameState.Boot);
    expect(() => app.onEnter(GameState.Boot, [RenderCtx], () => undefined)).toThrow(
      /stage-scoped param/,
    );
    expect(() => app.onExit(GameState.Boot, [RenderCtx], () => undefined)).toThrow(
      /stage-scoped param/,
    );
    expect(() =>
      app.onTransition(GameState.Boot, GameState.Playing, [RenderCtx], () => undefined),
    ).toThrow(/stage-scoped param/);
  });
});

describe('State-scoped resources', () => {
  class ScoreTracker {
    value = 0;
  }

  it('inserts on OnEnter and removes after OnExit', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    app.initState(GameState, GameState.Boot);
    app.insertStateScopedResource(GameState.Playing, new ScoreTracker());

    // Initially: resource not present.
    expect(app.getResource(ScoreTracker)).toBeUndefined();

    // Transition Boot → Playing inserts ScoreTracker before OnEnter(Playing).
    let observedInEnter: ScoreTracker | undefined = undefined;
    app.onEnter(GameState.Playing, [], () => {
      observedInEnter = app.getResource(ScoreTracker);
    });
    app.addSystem('preUpdate', [ResMut(NextState(GameState))], (next) => {
      if (app.getResource(State(GameState))?.current === GameState.Boot) {
        next.set(GameState.Playing);
      }
    });
    app.advanceFrame(0);
    app.advanceFrame(16);
    expect(observedInEnter).toBeInstanceOf(ScoreTracker);
    expect(app.getResource(ScoreTracker)).toBeInstanceOf(ScoreTracker);
  });

  it('user OnExit reads the resource one last time, then it is removed before State.current updates', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    app.initState(GameState, GameState.Boot);
    app.insertStateScopedResource(GameState.Playing, new ScoreTracker());

    const trace: string[] = [];
    let exitObserved: ScoreTracker | undefined = undefined;

    // Drive Boot → Playing on frame 2, Playing → Paused on frame 3.
    app.addSystem('preUpdate', [ResMut(NextState(GameState))], (next) => {
      const cur = app.getResource(State(GameState))?.current;
      if (cur === GameState.Boot) next.set(GameState.Playing);
      else if (cur === GameState.Playing) next.set(GameState.Paused);
    });
    app.onExit(GameState.Playing, [], () => {
      exitObserved = app.getResource(ScoreTracker);
      trace.push(`exit:has=${app.getResource(ScoreTracker) !== undefined}`);
    });
    app.onTransition(GameState.Playing, GameState.Paused, [], () => {
      // By this point the scoped resource has been removed.
      trace.push(`transition:has=${app.getResource(ScoreTracker) !== undefined}`);
    });

    app.advanceFrame(0); // initial → Boot
    app.advanceFrame(16); // Boot → Playing
    app.advanceFrame(32); // Playing → Paused

    expect(exitObserved).toBeInstanceOf(ScoreTracker);
    expect(trace).toEqual(['exit:has=true', 'transition:has=false']);
    // After the exit, the resource is gone.
    expect(app.getResource(ScoreTracker)).toBeUndefined();
  });
});
