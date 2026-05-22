import { describe, expect, it, spyOn } from 'bun:test';

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

import {
  App,
  createConsoleLogger,
  type Logger,
  RenderCtx,
  type RenderContext,
  Res,
  ResMut,
  RunCondition,
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

/** Renderer + surface stubs that satisfy the frame-loop calls without doing GPU work. */
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
    const app = new App({ renderer: makeHeadlessRenderer() });
    const e = app.world.spawn();
    expect(app.world.has(e, Symbol.for('any'))).toBe(false);
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
