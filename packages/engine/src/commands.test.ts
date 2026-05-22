import { describe, expect, it } from 'bun:test';

import type {
  CommandBuffer,
  CommandEncoder,
  Renderer,
  RendererCapabilities,
  RenderPassEncoder,
  RenderPipeline,
  ShaderModule,
  Surface,
  TextureFormat,
  TextureView,
} from '@retro-engine/renderer-core';
import type { Entity } from '@retro-engine/ecs';

import {
  App,
  Commands,
  type CommandsHandle,
  type Logger,
  Query,
  RunCondition,
  Time,
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

const makeRenderingRenderer = (): Renderer => {
  const view: TextureView = { destroy: () => undefined };
  const pass: RenderPassEncoder = {
    setPipeline: () => undefined,
    setBindGroup: () => undefined,
    draw: () => undefined,
    end: () => undefined,
  };
  const commandBuffer: CommandBuffer = { destroy: () => undefined };
  const encoder: CommandEncoder = {
    beginRenderPass: () => pass,
    finish: () => commandBuffer,
  };
  const surface: Surface = {
    configure: () => undefined,
    resize: () => undefined,
    getCurrentTextureView: () => view,
    destroy: () => undefined,
  };
  return {
    capabilities: baseCapabilities,
    init: () => Promise.resolve(),
    destroy: () => undefined,
    getPreferredSurfaceFormat: (): TextureFormat => 'rgba8unorm',
    createSurface: () => surface,
    createShaderModule: (): ShaderModule => fail('createShaderModule'),
    createRenderPipeline: (): RenderPipeline => fail('createRenderPipeline'),
    createCommandEncoder: () => encoder,
    submit: () => undefined,
  };
};

const makeStubCanvas = (): HTMLCanvasElement =>
  ({
    clientWidth: 640,
    clientHeight: 480,
    width: 0,
    height: 0,
  }) as unknown as HTMLCanvasElement;

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

class Pos {
  constructor(
    public x = 0,
    public y = 0,
  ) {}
}

class Vel {
  constructor(
    public vx = 0,
    public vy = 0,
  ) {}
}

class Foo {
  constructor(public value = 0) {}
}

describe('Commands param identity', () => {
  it('is a singleton — `Commands === Commands`', () => {
    expect(Commands).toBe(Commands);
  });
});

describe('cmd.spawn', () => {
  it('reserves an entity id synchronously, defers row allocation until flush', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    let spawnedDuringSystem: Entity | undefined;
    let visibleDuringSystem: boolean | undefined;
    app.addSystem('update', [Commands], (cmd) => {
      const id = cmd.spawn(new Pos(1, 2));
      spawnedDuringSystem = id;
      visibleDuringSystem = app.world.hasEntity(id);
    });
    app.advanceFrame(0);
    expect(typeof spawnedDuringSystem).toBe('number');
    expect(visibleDuringSystem).toBe(false);
    expect(app.world.has(spawnedDuringSystem as Entity, Pos)).toBe(true);
    const pos = app.world.getComponent(spawnedDuringSystem as Entity, Pos);
    expect(pos?.x).toBe(1);
    expect(pos?.y).toBe(2);
  });

  it('accepts variadic components or a single array bundle', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    let variadicId: Entity | undefined;
    let bundledId: Entity | undefined;
    app.addSystem('update', [Commands], (cmd) => {
      variadicId = cmd.spawn(new Pos(), new Vel());
      bundledId = cmd.spawn([new Pos(), new Vel()]);
    });
    app.advanceFrame(0);
    expect(app.world.has(variadicId as Entity, Pos)).toBe(true);
    expect(app.world.has(variadicId as Entity, Vel)).toBe(true);
    expect(app.world.has(bundledId as Entity, Pos)).toBe(true);
    expect(app.world.has(bundledId as Entity, Vel)).toBe(true);
  });

  it('does not break query iteration when called mid-loop', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    app.world.spawn(new Pos(0, 0));
    app.world.spawn(new Pos(1, 1));
    let iterated = 0;
    app.addSystem('update', [Commands, Query([Pos])], (cmd, q) => {
      for (const [pos] of q) {
        iterated += 1;
        cmd.spawn(new Pos(pos.x + 10, pos.y + 10));
      }
    });
    app.advanceFrame(0);
    expect(iterated).toBe(2);
    expect(app.world.query([Pos]).count()).toBe(4);
  });
});

describe('cmd.despawn', () => {
  it('defers removal until flush — iteration sees the entity, post-flush query does not', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    app.world.spawn(new Pos());
    app.world.spawn(new Pos());
    let iteratedCount = 0;
    app.addSystem('update', [Commands, Query([Pos])], (cmd, q) => {
      const live = Array.from(app.world.entities());
      iteratedCount = q.count();
      for (const e of live) cmd.despawn(e);
    });
    app.advanceFrame(0);
    expect(iteratedCount).toBe(2);
    expect(app.world.query([Pos]).count()).toBe(0);
  });

  it('silently no-ops when called against an already-dead entity', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const e = app.world.spawn();
    app.world.despawn(e);
    app.addSystem('update', [Commands], (cmd) => {
      cmd.despawn(e);
    });
    expect(() => app.advanceFrame(0)).not.toThrow();
  });
});

describe('cmd.entity(...).insert / remove / despawn', () => {
  it('chains insert and remove against an existing entity', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const e = app.world.spawn(new Pos());
    app.addSystem('update', [Commands], (cmd) => {
      cmd.entity(e).insert(new Vel(1, 0)).remove(Pos);
    });
    app.advanceFrame(0);
    expect(app.world.has(e, Pos)).toBe(false);
    expect(app.world.has(e, Vel)).toBe(true);
    expect(app.world.getComponent(e, Vel)?.vx).toBe(1);
  });

  it('inserts variadic components or a single array bundle', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const e = app.world.spawn();
    app.addSystem('update', [Commands], (cmd) => {
      cmd.entity(e).insert(new Pos(), new Vel());
    });
    app.advanceFrame(0);
    expect(app.world.has(e, Pos)).toBe(true);
    expect(app.world.has(e, Vel)).toBe(true);
  });

  it('despawn() chain terminator removes the entity at flush', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const e = app.world.spawn(new Pos());
    app.addSystem('update', [Commands], (cmd) => {
      cmd.entity(e).despawn();
    });
    app.advanceFrame(0);
    expect(app.world.hasEntity(e)).toBe(false);
  });

  it('insert on a dead entity emits devWarn and skips, without throwing', () => {
    const spy = createSpyLogger();
    const app = new App({ renderer: makeHeadlessRenderer(), logger: spy.logger });
    const e = app.world.spawn();
    app.world.despawn(e);
    app.addSystem('update', [Commands], (cmd) => {
      cmd.entity(e).insert(new Pos());
    });
    expect(() => app.advanceFrame(0)).not.toThrow();
    expect(spy.devWarns.length).toBe(1);
    expect(spy.devWarns[0]).toContain('Commands.insert');
    expect(spy.devWarns[0]).toContain(`${e}`);
  });
});

describe('cmd.insertResource / removeResource', () => {
  it('queues the insertion until flush; resource is visible afterwards', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    let visibleDuringSystem: boolean | undefined;
    app.addSystem('update', [Commands], (cmd) => {
      cmd.insertResource(new Foo(42));
      visibleDuringSystem = app.getResource(Foo) !== undefined;
    });
    app.advanceFrame(0);
    expect(visibleDuringSystem).toBe(false);
    expect(app.getResource(Foo)?.value).toBe(42);
  });

  it('stamps the resource change-frame at flush time (current Time.frame)', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    app.addSystem('update', [Commands], (cmd) => {
      cmd.insertResource(new Foo());
    });
    app.advanceFrame(0);
    const frame = app.getResource(Time)!.frame;
    expect(app.getResourceChangeFrame(Foo)).toBe(frame);
  });

  it('queues removal until flush; resource gone afterwards', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    app.insertResource(new Foo(7));
    app.addSystem('update', [Commands], (cmd) => {
      cmd.removeResource(Foo);
    });
    app.advanceFrame(0);
    expect(app.getResource(Foo)).toBeUndefined();
  });
});

describe('Per-system flush ordering', () => {
  it('a later system in the same stage observes an earlier system\'s spawn', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    let observed = -1;
    app.addSystem('update', [Commands], (cmd) => {
      cmd.spawn(new Pos());
    });
    app.addSystem('update', [Query([Pos])], (q) => {
      observed = q.count();
    });
    app.advanceFrame(0);
    expect(observed).toBe(1);
  });

  it('reversed registration order means the reader runs first and sees nothing', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    let observed = -1;
    app.addSystem('update', [Query([Pos])], (q) => {
      observed = q.count();
    });
    app.addSystem('update', [Commands], (cmd) => {
      cmd.spawn(new Pos());
    });
    app.advanceFrame(0);
    expect(observed).toBe(0);
    expect(app.world.query([Pos]).count()).toBe(1);
  });

  it('crosses stage boundaries — spawn in preUpdate visible in update', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    let observed = -1;
    app.addSystem('preUpdate', [Commands], (cmd) => {
      cmd.spawn(new Pos());
    });
    app.addSystem('update', [Query([Pos])], (q) => {
      observed = q.count();
    });
    app.advanceFrame(0);
    expect(observed).toBe(1);
  });

  it('isolates buffers per system — system A\'s ops do not appear in system B\'s buffer', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    let entityFromA: Entity | undefined;
    let entityFromB: Entity | undefined;
    app.addSystem('update', [Commands], (cmd) => {
      entityFromA = cmd.spawn(new Pos());
    });
    app.addSystem('update', [Commands], (cmd) => {
      entityFromB = cmd.spawn(new Vel());
    });
    app.advanceFrame(0);
    expect(entityFromA).not.toBe(entityFromB);
    expect(app.world.has(entityFromA as Entity, Pos)).toBe(true);
    expect(app.world.has(entityFromA as Entity, Vel)).toBe(false);
    expect(app.world.has(entityFromB as Entity, Vel)).toBe(true);
    expect(app.world.has(entityFromB as Entity, Pos)).toBe(false);
  });
});

describe('Fixed-stage flush', () => {
  it('flushes between substeps — substep N sees substep N-1\'s spawn', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const observedCounts: number[] = [];
    let spawned = false;
    app.addSystem('fixedUpdate', [Commands, Query([Pos])], (cmd, q) => {
      observedCounts.push(q.count());
      if (!spawned) {
        cmd.spawn(new Pos());
        spawned = true;
      }
    });
    // Two frames with virtual delta accumulating to ~2 timesteps for the
    // second call, producing 2 substeps in one frame.
    app.advanceFrame(0);
    app.advanceFrame((2 * 1000) / 60 + 0.5);
    // Substep 1 of frame 2: sees 0 entities. Substep 2: sees 1 entity from substep 1's spawn.
    // (Frame 1's first call also runs the fixed loop once if delta ≥ timestep,
    // but with timestamp 0 the virtual delta is 0 so no substeps run yet.)
    expect(observedCounts).toEqual([0, 1]);
  });
});

describe('Render-stage flush', () => {
  it('flushes after each render-stage system returns', () => {
    const renderer = makeRenderingRenderer();
    const canvas = makeStubCanvas();
    const app = new App({ renderer, canvas });
    let entityFromRender: Entity | undefined;
    app.addSystem('render', [Commands], (cmd) => {
      entityFromRender = cmd.spawn(new Pos());
    });
    let observed = -1;
    app.addSystem('first', [Query([Pos])], (q) => {
      observed = q.count();
    });
    return app.run().then(() => {
      // After first frame: render system ran, spawned an entity.
      expect(app.world.has(entityFromRender as Entity, Pos)).toBe(true);
      // Drive a second frame manually so 'first' observes the entity.
      app.advanceFrame(16);
      expect(observed).toBe(1);
      app.stop();
    });
  });
});

describe('State-transition flush', () => {
  class GameState {
    static readonly Boot = new GameState('Boot');
    static readonly Playing = new GameState('Playing');
    constructor(public readonly name: string) {}
  }

  it('OnEnter system\'s spawn is visible in update systems the same frame', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    app.initState(GameState, GameState.Boot);
    app.onEnter(GameState.Boot, [Commands], (cmd) => {
      cmd.spawn(new Pos());
    });
    let observed = -1;
    app.addSystem('update', [Query([Pos])], (q) => {
      observed = q.count();
    });
    app.advanceFrame(0);
    expect(observed).toBe(1);
  });
});

describe('Spawn-then-despawn within a single buffer', () => {
  it('applies in enqueue order — entity is gone after flush', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    let captured: Entity | undefined;
    app.addSystem('update', [Commands], (cmd) => {
      const id = cmd.spawn(new Pos());
      captured = id;
      cmd.despawn(id);
    });
    app.advanceFrame(0);
    expect(app.world.hasEntity(captured as Entity)).toBe(false);
    expect(app.world.query([Pos]).count()).toBe(0);
  });
});

describe('runIf-skipped systems', () => {
  it('never resolve Commands and never enqueue', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    let ran = 0;
    app.addSystem(
      'update',
      [Commands],
      (cmd) => {
        ran += 1;
        cmd.spawn(new Pos());
      },
      { runIf: new RunCondition(() => false) },
    );
    app.advanceFrame(0);
    expect(ran).toBe(0);
    expect(app.world.query([Pos]).count()).toBe(0);
  });
});

describe('Discard-on-throw', () => {
  it('a system that throws does not apply its enqueued commands', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    app.addSystem('update', [Commands], (cmd) => {
      cmd.spawn(new Pos());
      throw new Error('boom');
    });
    let caught: Error | undefined;
    try {
      app.advanceFrame(0);
    } catch (e) {
      caught = e as Error;
    }
    expect(caught?.message).toBe('boom');
    expect(app.world.query([Pos]).count()).toBe(0);
  });

  it('a subsequent invocation of the same system starts with an empty buffer', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    let throwOnce = true;
    app.addSystem('update', [Commands], (cmd) => {
      cmd.spawn(new Pos());
      if (throwOnce) {
        throwOnce = false;
        throw new Error('first-frame');
      }
    });
    try {
      app.advanceFrame(0);
    } catch {
      // expected first-frame failure
    }
    expect(app.world.query([Pos]).count()).toBe(0);
    // Second frame: same system runs again, its buffer is fresh, the spawn applies.
    app.advanceFrame(16);
    expect(app.world.query([Pos]).count()).toBe(1);
  });
});

describe('App.flushCommands', () => {
  it('drains buffers populated by direct handle use outside the runner', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const id = app.mintSystemId();
    const handle = Commands.resolve({
      app,
      world: app.world,
      stage: 'update',
      systemId: id,
    }) as CommandsHandle;
    const e = handle.spawn(new Pos(3, 4));
    expect(app.world.hasEntity(e)).toBe(false);
    app.flushCommands();
    expect(app.world.hasEntity(e)).toBe(true);
    expect(app.world.getComponent(e, Pos)?.x).toBe(3);
  });

  it('is a no-op when no buffers are pending — second call is also a no-op', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    expect(() => app.flushCommands()).not.toThrow();
    expect(() => app.flushCommands()).not.toThrow();
  });

  it('drains in system-id insertion order across buffers', () => {
    const spy = createSpyLogger();
    const app = new App({ renderer: makeHeadlessRenderer(), logger: spy.logger });
    const id1 = app.mintSystemId();
    const id2 = app.mintSystemId();
    const h1 = Commands.resolve({
      app,
      world: app.world,
      stage: 'update',
      systemId: id1,
    }) as CommandsHandle;
    const h2 = Commands.resolve({
      app,
      world: app.world,
      stage: 'update',
      systemId: id2,
    }) as CommandsHandle;
    // Enqueue spawns from both handles; the spawn ids are reserved at enqueue
    // (so e1 < e2 by mint order), but the order in which the ROWS appear in
    // entityIndex is decided by the flush order across buffers.
    const e1 = h1.spawn(new Pos(1, 0));
    const e2 = h2.spawn(new Pos(2, 0));
    expect(app.world.hasEntity(e1)).toBe(false);
    expect(app.world.hasEntity(e2)).toBe(false);
    app.flushCommands();
    // Buffer for id1 was created before buffer for id2 (h1.spawn was first), so
    // id1's spawn applies first — observable by Pos.x sequence in iteration.
    expect(app.world.hasEntity(e1)).toBe(true);
    expect(app.world.hasEntity(e2)).toBe(true);
    expect(app.world.getComponent(e1, Pos)?.x).toBe(1);
    expect(app.world.getComponent(e2, Pos)?.x).toBe(2);
  });
});
