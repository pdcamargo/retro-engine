import { describe, expect, it, spyOn } from 'bun:test';

import {
  App,
  Camera2d,
  createConsoleLogger,
  inState,
  type Logger,
  NextState,
  Query,
  RenderCtx,
  type RenderContext,
  Res,
  ResMut,
  RunCondition,
  State,
  Time,
} from './index';
import { makeHeadlessRenderer, makeRenderingRenderer, makeStubCanvas } from './test-utils';

describe('App', () => {
  it('accepts plugins and runs startup systems', async () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    let startupRan = 0;
    app.addPlugin((a) => {
      a.addSystem('startup', [], () => {
        startupRan += 1;
      });
    });
    await app.run();
    app.stop();
    expect(startupRan).toBe(1);
  });

  it('exposes a `World` for systems', () => {
    class NotAttached {}
    const app = new App({ renderer: makeHeadlessRenderer() });
    const e = app.world.spawn();
    expect(app.world.has(e, NotAttached)).toBe(false);
  });

  it('skips the render stage when no canvas is provided', async () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    let renderRan = 0;
    app.addSystem('render', [], () => {
      renderRan += 1;
    });
    await app.run();
    app.stop();
    expect(renderRan).toBe(0);
  });
});

describe('System param protocol', () => {
  it('runs zero-param systems with empty params tuple', async () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    let updateRan = 0;
    app.addSystem('update', [], () => {
      updateRan += 1;
    });
    await app.run();
    app.stop();
    expect(updateRan).toBe(1);
  });

  it('injects a registered resource via ResMut(ctor)', async () => {
    class Score {
      value = 0;
    }
    const app = new App({ renderer: makeHeadlessRenderer() });
    app.insertResource(new Score());
    app.addSystem('update', [ResMut(Score)], (score) => {
      score.value = 7;
    });
    await app.run();
    app.stop();
    expect(app.getResource(Score)?.value).toBe(7);
  });

  it('resolves RenderCtx to the active frame context in render systems', async () => {
    const app = new App({ renderer: makeRenderingRenderer(), canvas: makeStubCanvas() });
    app.world.spawn(...Camera2d());
    let received: RenderContext | undefined;
    app.addSystem('render', [RenderCtx], (ctx) => {
      received = ctx;
    });
    await app.run();
    app.stop();
    expect(received).toBeDefined();
    expect(received?.pass).toBeDefined();
    expect(received?.encoder).toBeDefined();
    expect(received?.surfaceView).toBeDefined();
    expect(received?.camera).toBeDefined();
  });

  it('skips a system whose runIf condition returns false', async () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    let ran = 0;
    app.addSystem(
      'update',
      [],
      () => {
        ran += 1;
      },
      { runIf: new RunCondition(() => false) },
    );
    await app.run();
    app.stop();
    expect(ran).toBe(0);
  });

  it('throws when a stage-scoped param is registered in the wrong stage', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    expect(() => app.addSystem('update', [RenderCtx], () => undefined)).toThrow();
  });
});

describe('Query system param', () => {
  it('resolves to an iterable query handle and mutates component data', async () => {
    class A {
      constructor(public x = 0) {}
    }
    class B {
      constructor(public v = 0) {}
    }
    const app = new App({ renderer: makeHeadlessRenderer() });
    app.world.spawn(new A(0), new B(1));
    app.world.spawn(new A(10), new B(2));
    let total = 0;
    app.addSystem('update', [Query([A, B])], (q) => {
      for (const [a, b] of q) {
        a.x += b.v;
        total += a.x;
      }
    });
    await app.run();
    app.stop();
    // First entity: 0+1 = 1; second: 10+2 = 12; sum = 13.
    expect(total).toBe(13);
    // Mutations persist on the underlying instances.
    const rows = [...app.world.query([A])];
    const xs = rows.map(([a]) => a.x).sort((p, q) => p - q);
    expect(xs).toEqual([1, 12]);
  });

  it('caches param tokens per (types-order, filter-shape)', () => {
    class A {}
    class B {}
    class C {}
    expect(Query([A, B])).toBe(Query([A, B]));
    expect(Query([A, B])).not.toBe(Query([B, A]));
    expect(Query([A, B])).not.toBe(Query([A]));
    expect(Query([A], { with: [B] })).toBe(Query([A], { with: [B] }));
    expect(Query([A], { with: [B] })).not.toBe(Query([A], { with: [C] }));
    // `with` is set-semantic — order doesn't matter.
    expect(Query([A], { with: [B, C] })).toBe(Query([A], { with: [C, B] }));
  });
});

interface SpyLogger {
  readonly logger: Logger;
  readonly calls: {
    error: string[];
    warn: string[];
    info: string[];
    debug: string[];
    devWarn: string[];
  };
}

const createSpyLogger = (): SpyLogger => {
  const calls = { error: [], warn: [], info: [], debug: [], devWarn: [] } as SpyLogger['calls'];
  const logger: Logger = {
    error: (m) => {
      calls.error.push(m);
    },
    warn: (m) => {
      calls.warn.push(m);
    },
    info: (m) => {
      calls.info.push(m);
    },
    debug: (m) => {
      calls.debug.push(m);
    },
    devWarn: (m) => {
      calls.devWarn.push(m);
    },
    child: () => logger,
  };
  return { logger, calls };
};

const withNodeEnv = async <T>(value: string | undefined, fn: () => Promise<T> | T): Promise<T> => {
  const original = process.env.NODE_ENV;
  if (value === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = value;
  try {
    return await fn();
  } finally {
    if (original === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = original;
  }
};

describe('Resource registry', () => {
  it('round-trips insert, get, and remove', () => {
    class Counter {
      value = 0;
    }
    const app = new App({ renderer: makeHeadlessRenderer() });
    const inserted = new Counter();
    inserted.value = 5;
    app.insertResource(inserted);
    expect(app.getResource(Counter)).toBe(inserted);

    const removed = app.removeResource(Counter);
    expect(removed).toBe(inserted);
    expect(app.getResource(Counter)).toBeUndefined();

    // Idempotent: removing again returns undefined rather than throwing.
    expect(app.removeResource(Counter)).toBeUndefined();
  });

  it('emits a single devWarn through the App logger when replacing a resource', () => {
    class Counter {
      value = 0;
    }
    const spy = createSpyLogger();
    const app = new App({ renderer: makeHeadlessRenderer(), logger: spy.logger });
    app.insertResource(new Counter());
    expect(spy.calls.devWarn).toHaveLength(0);
    app.insertResource(new Counter());
    expect(spy.calls.devWarn).toHaveLength(1);
    expect(spy.calls.devWarn[0]).toContain('Counter');
    expect(spy.calls.warn).toHaveLength(0);
  });

  it('is silent on replace when NODE_ENV is production', async () => {
    class Counter {
      value = 0;
    }
    await withNodeEnv('production', () => {
      const warnSpy = spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        const app = new App({ renderer: makeHeadlessRenderer() });
        app.insertResource(new Counter());
        app.insertResource(new Counter());
        expect(warnSpy).not.toHaveBeenCalled();
      } finally {
        warnSpy.mockRestore();
      }
    });
  });

  it('throws a named "missing resource" error from Res(ctor)', async () => {
    class Missing {}
    const app = new App({ renderer: makeHeadlessRenderer() });
    app.addSystem('update', [Res(Missing)], () => undefined);
    await expect(app.run()).rejects.toThrow(
      /^Res\(Missing\): resource not registered — did you forget app\.insertResource\(new Missing\(\)\)\?$/,
    );
    app.stop();
  });

  it('throws a named "missing resource" error from ResMut(ctor)', async () => {
    class Missing {}
    const app = new App({ renderer: makeHeadlessRenderer() });
    app.addSystem('update', [ResMut(Missing)], () => undefined);
    await expect(app.run()).rejects.toThrow(
      /^ResMut\(Missing\): resource not registered — did you forget app\.insertResource\(new Missing\(\)\)\?$/,
    );
    app.stop();
  });

  it('Res(ctor) and ResMut(ctor) are distinct tokens; each is cached', () => {
    class Foo {}
    expect(Res(Foo)).not.toBe(ResMut(Foo) as unknown);
    expect(Res(Foo)).toBe(Res(Foo));
    expect(ResMut(Foo)).toBe(ResMut(Foo));
  });

  it('Res<T> forbids mutations at the type level; runtime behaviour matches ResMut<T>', async () => {
    class Score {
      value = 0;
      inner = { value: 0 };
    }
    const app = new App({ renderer: makeHeadlessRenderer() });
    app.insertResource(new Score());
    app.addSystem('update', [Res(Score)], (score) => {
      // @ts-expect-error — shallow write through Res<T> is a compile error
      score.value = 1;
      // @ts-expect-error — nested write through Res<T> is a compile error
      score.inner.value = 1;
    });
    await app.run();
    app.stop();
    // Runtime behaviour is identical to ResMut — same live instance.
    expect(app.getResource(Score)?.value).toBe(1);
    expect(app.getResource(Score)?.inner.value).toBe(1);
  });

  it('ResMut<T> allows the same shallow and nested writes at the type level', async () => {
    class Score {
      value = 0;
      inner = { value: 0 };
    }
    const app = new App({ renderer: makeHeadlessRenderer() });
    app.insertResource(new Score());
    app.addSystem('update', [ResMut(Score)], (score) => {
      score.value = 1;
      score.inner.value = 1;
    });
    await app.run();
    app.stop();
    expect(app.getResource(Score)?.value).toBe(1);
    expect(app.getResource(Score)?.inner.value).toBe(1);
  });
});

describe('Engine logger', () => {
  it('child(category) prefixes emissions with [category]', () => {
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      createConsoleLogger().child('renderer-webgpu').warn('shader compile failed');
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith('[renderer-webgpu] shader compile failed');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('nested child(category) composes prefixes', () => {
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      createConsoleLogger().child('renderer-webgpu').child('shader').warn('m');
      expect(warnSpy).toHaveBeenCalledWith('[renderer-webgpu][shader] m');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('devWarn emits in development and is silent in production', async () => {
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await withNodeEnv('development', () => {
        createConsoleLogger().devWarn('dev message');
      });
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith('dev message');

      warnSpy.mockClear();
      await withNodeEnv('production', () => {
        createConsoleLogger().devWarn('prod message');
      });
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('App.logger honours AppOptions.logger over the module-global default', () => {
    class Counter {
      value = 0;
    }
    const spy = createSpyLogger();
    const app = new App({ renderer: makeHeadlessRenderer(), logger: spy.logger });
    expect(app.logger).toBe(spy.logger);
    app.insertResource(new Counter());
    app.insertResource(new Counter());
    expect(spy.calls.devWarn).toHaveLength(1);
  });
});

describe('M2 phase 5 integration', () => {
  class GameState {
    static readonly Boot = new GameState('Boot');
    static readonly MainMenu = new GameState('MainMenu');
    static readonly Loading = new GameState('Loading');
    static readonly Playing = new GameState('Playing');
    constructor(public readonly name: string) {}
  }

  class FixedCounter {
    ticks = 0;
  }

  it('exercises the full Main + StateTransition + FixedMain + ordering surface end-to-end', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const enters: string[] = [];
    const exits: string[] = [];
    const updateOrder: string[] = [];

    app.initState(GameState, GameState.Boot);
    app.insertResource(new FixedCounter());

    app.onEnter(GameState.Boot, [], () => enters.push('Boot'));
    app.onExit(GameState.Boot, [], () => exits.push('Boot'));
    app.onEnter(GameState.MainMenu, [], () => enters.push('MainMenu'));
    app.onExit(GameState.MainMenu, [], () => exits.push('MainMenu'));
    app.onEnter(GameState.Loading, [], () => enters.push('Loading'));
    app.onExit(GameState.Loading, [], () => exits.push('Loading'));
    app.onEnter(GameState.Playing, [], () => enters.push('Playing'));

    // Ordering within `update`: input → physics → ai.
    app.addSystem('update', [], () => updateOrder.push('ai'), { after: ['physics'] });
    app.addSystem('update', [], () => updateOrder.push('input'), { label: 'input' });
    app.addSystem('update', [], () => updateOrder.push('physics'), {
      label: 'physics',
      after: ['input'],
    });

    // Drive the state machine deterministically frame-by-frame.
    let nextTarget: GameState | undefined = undefined;
    app.addSystem('preUpdate', [ResMut(NextState(GameState))], (next) => {
      if (nextTarget !== undefined) {
        next.set(nextTarget);
        nextTarget = undefined;
      }
    });

    // FixedUpdate increments only while Playing — runIf gating across stages.
    app.addSystem('fixedUpdate', [ResMut(FixedCounter)], (c) => c.ticks++, {
      runIf: inState(GameState.Playing),
    });

    // Frame 1: initial transition fires OnEnter(Boot).
    app.advanceFrame(0);
    expect(enters).toEqual(['Boot']);
    expect(exits).toEqual([]);
    expect(updateOrder).toEqual(['input', 'physics', 'ai']);
    expect(app.getResource(FixedCounter)!.ticks).toBe(0);

    // Frame 2: queue MainMenu, advance to MainMenu.
    nextTarget = GameState.MainMenu;
    updateOrder.length = 0;
    app.advanceFrame(16);
    expect(enters).toEqual(['Boot', 'MainMenu']);
    expect(exits).toEqual(['Boot']);
    expect(app.getResource(State(GameState))!.current).toBe(GameState.MainMenu);

    // Frame 3: MainMenu → Loading.
    nextTarget = GameState.Loading;
    app.advanceFrame(32);
    expect(enters[enters.length - 1]).toBe('Loading');
    expect(exits[exits.length - 1]).toBe('MainMenu');

    // Frame 4: Loading → Playing. Wall-delta = 50ms = 3 fixed substeps at 1/60Hz.
    nextTarget = GameState.Playing;
    app.advanceFrame(82);
    expect(enters[enters.length - 1]).toBe('Playing');
    expect(exits[exits.length - 1]).toBe('Loading');
    // Three fixed substeps accumulated this frame (post-transition, runIf
    // sees Playing, fixedUpdate ticks the counter).
    expect(app.getResource(FixedCounter)!.ticks).toBe(3);

    // Frame 5: stay in Playing, advance ~16ms = 1 substep.
    app.advanceFrame(82 + 17);
    expect(app.getResource(FixedCounter)!.ticks).toBe(4);

    // Render systems didn't register; no errors from the empty render stage.
    // Time monotonic across all advances:
    expect(app.getResource(Time)!.frame).toBe(5);
  });
});
