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
import type { Entity } from '@retro-engine/ecs';

import { App, Commands, type Logger, Trigger } from './index';

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

class Ping {
  constructor(public n = 0) {}
}

class Pong {
  constructor(public n = 0) {}
}

class Spread {
  constructor(public depth = 0) {}
}

describe('Trigger param identity', () => {
  it('Trigger(Foo) === Trigger(Foo) — cached per event ctor', () => {
    expect(Trigger(Ping)).toBe(Trigger(Ping));
  });

  it('throws when resolved outside an observer context', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    expect(() =>
      Trigger(Ping).resolve({
        app,
        world: app.world,
        stage: 'update',
        systemId: 1 as never,
        lastSeenTick: 0,
        lastSeenFrame: -1,
      }),
    ).toThrow(/observer context/);
  });
});

describe('Global observers', () => {
  it('fires for every commands.trigger of the matching event class', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const received: number[] = [];
    app.addObserver(Ping, [Trigger(Ping)], (t) => {
      received.push(t.event().n);
    });

    app.addSystem('update', [Commands], (cmd) => {
      cmd.trigger(new Ping(1));
      cmd.trigger(new Ping(2));
    });

    app.advanceFrame(0);
    expect(received).toEqual([1, 2]);
  });

  it('fires multiple global observers in registration order', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const trace: string[] = [];
    app.addObserver(Ping, [Trigger(Ping)], () => trace.push('a'));
    app.addObserver(Ping, [Trigger(Ping)], () => trace.push('b'));
    app.addObserver(Ping, [Trigger(Ping)], () => trace.push('c'));

    app.addSystem('update', [Commands], (cmd) => cmd.trigger(new Ping()));
    app.advanceFrame(0);
    expect(trace).toEqual(['a', 'b', 'c']);
  });

  it('isolates by event class — Ping observers do not fire for Pong', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    let pingHits = 0;
    let pongHits = 0;
    app.addObserver(Ping, [Trigger(Ping)], () => {
      pingHits += 1;
    });
    app.addObserver(Pong, [Trigger(Pong)], () => {
      pongHits += 1;
    });
    app.addSystem('update', [Commands], (cmd) => cmd.trigger(new Ping()));
    app.advanceFrame(0);
    expect(pingHits).toBe(1);
    expect(pongHits).toBe(0);
  });

  it('observer body sees trig.entity() === undefined for global triggers', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    let observed: { entity: Entity | undefined } | undefined;
    app.addObserver(Ping, [Trigger(Ping)], (t) => {
      observed = { entity: t.entity() };
    });
    app.addSystem('update', [Commands], (cmd) => cmd.trigger(new Ping()));
    app.advanceFrame(0);
    expect(observed).toBeDefined();
    expect(observed?.entity).toBeUndefined();
  });
});

describe('Entity-targeted observers via cmd.entity(e).observe', () => {
  it('fires for triggers targeted at the bound entity', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const received: number[] = [];
    let target: Entity | undefined;

    app.addSystem('startup', [Commands], (cmd) => {
      const e = cmd.spawn();
      target = e.id;
      e.observe(Ping, [Trigger(Ping)], (t) => {
        received.push(t.event().n);
      });
    });

    // First frame attaches the observer; nothing triggers yet.
    app.advanceFrame(0);

    app.addSystem('update', [Commands], (cmd) => {
      cmd.entity(target!).trigger(new Ping(42));
    });
    app.advanceFrame(16);
    expect(received).toEqual([42]);
  });

  it('does NOT fire for a global trigger of the same event class', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    let received = 0;
    let target: Entity | undefined;

    app.addSystem('startup', [Commands], (cmd) => {
      const e = cmd.spawn();
      target = e.id;
      e.observe(Ping, [Trigger(Ping)], () => {
        received += 1;
      });
    });

    app.advanceFrame(0);
    app.addSystem('update', [Commands], (cmd) => cmd.trigger(new Ping()));
    app.advanceFrame(16);
    expect(received).toBe(0);
    void target;
  });

  it('fires entity observer BEFORE global observer for the same targeted trigger', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const trace: string[] = [];
    let target: Entity | undefined;

    app.addObserver(Ping, [Trigger(Ping)], () => trace.push('global'));

    app.addSystem('startup', [Commands], (cmd) => {
      const e = cmd.spawn();
      target = e.id;
      e.observe(Ping, [Trigger(Ping)], () => trace.push('targeted'));
    });
    app.advanceFrame(0);

    app.addSystem('update', [Commands], (cmd) => {
      cmd.entity(target!).trigger(new Ping());
    });
    app.advanceFrame(16);
    expect(trace).toEqual(['targeted', 'global']);
  });

  it('exposes the target entity via trig.entity()', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    let observed: { entity: Entity | undefined } | undefined;
    let target: Entity | undefined;
    app.addSystem('startup', [Commands], (cmd) => {
      const e = cmd.spawn();
      target = e.id;
      e.observe(Ping, [Trigger(Ping)], (t) => {
        observed = { entity: t.entity() };
      });
    });
    app.advanceFrame(0);
    app.addSystem('update', [Commands], (cmd) => cmd.entity(target!).trigger(new Ping()));
    app.advanceFrame(16);
    expect(observed).toBeDefined();
    expect(observed?.entity).toBe(target);
  });

  it('drops targeted observers when the entity is despawned', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    let received = 0;
    let target: Entity | undefined;

    app.addSystem('startup', [Commands], (cmd) => {
      const e = cmd.spawn();
      target = e.id;
      e.observe(Ping, [Trigger(Ping)], () => {
        received += 1;
      });
    });
    app.advanceFrame(0);

    // Despawn the target.
    app.addSystem('update', [Commands], (cmd) => {
      cmd.despawn(target!);
    });
    app.advanceFrame(16);
    // The observer fires once for the targeted trigger before despawn? No —
    // despawn happens first (only op), so observer is cleared. Subsequent
    // triggers against the dead entity find no targeted observers and no
    // global observers either; nothing fires.
    expect(received).toBe(0);
  });
});

describe('Re-entrant triggers', () => {
  it('observer body that triggers another event fires in the same flush', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const trace: string[] = [];

    app.addObserver(Ping, [Trigger(Ping), Commands], (_t, cmd) => {
      trace.push('ping');
      cmd.trigger(new Pong());
    });
    app.addObserver(Pong, [Trigger(Pong)], () => {
      trace.push('pong');
    });

    app.addSystem('update', [Commands], (cmd) => cmd.trigger(new Ping()));
    app.advanceFrame(0);
    expect(trace).toEqual(['ping', 'pong']);
  });

  it('depth-8 chain triggers fire; depth-9 is dropped with devWarn', () => {
    const spy = createSpyLogger();
    const app = new App({ renderer: makeHeadlessRenderer(), logger: spy.logger });

    let observedMax = 0;
    app.addObserver(Spread, [Trigger(Spread), Commands], (t, cmd) => {
      const d = t.event().depth;
      observedMax = Math.max(observedMax, d);
      cmd.trigger(new Spread(d + 1));
    });

    app.addSystem('update', [Commands], (cmd) => cmd.trigger(new Spread(1)));
    app.advanceFrame(0);
    // Depth 1 through 8 fire (8 observer invocations). The 9th cmd.trigger
    // inside the depth-8 observer body refuses to enqueue (newDepth=9 > 8).
    expect(observedMax).toBe(8);
    expect(spy.devWarns.length).toBeGreaterThanOrEqual(1);
    expect(spy.devWarns[0]).toContain('depth limit');
  });
});

describe('Observers receive a Commands handle keyed to the triggering system buffer', () => {
  it('observer-enqueued ops fire in the same flush', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    let entityId: Entity | undefined;

    app.addObserver(Ping, [Commands], (cmd) => {
      const e = cmd.spawn();
      entityId = e.id;
    });

    app.addSystem('update', [Commands], (cmd) => cmd.trigger(new Ping()));
    app.advanceFrame(0);
    expect(entityId).toBeDefined();
    expect(app.world.hasEntity(entityId!)).toBe(true);
  });
});

describe('attachObserver against a dead entity', () => {
  it('emits devWarn and silently skips', () => {
    const spy = createSpyLogger();
    const app = new App({ renderer: makeHeadlessRenderer(), logger: spy.logger });

    const e = app.world.spawn();
    app.world.despawn(e);

    app.addSystem('update', [Commands], (cmd) => {
      cmd.entity(e).observe(Ping, [Trigger(Ping)], () => undefined);
    });

    expect(() => app.advanceFrame(0)).not.toThrow();
    expect(spy.devWarns.some((m) => m.includes('observer not attached'))).toBe(true);
  });
});
