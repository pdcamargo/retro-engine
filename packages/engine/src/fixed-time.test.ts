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

import { App, type Logger, ResMut, Time } from './index';

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
  readonly warns: string[];
}

const createSpyLogger = (): SpyLogger => {
  const warns: string[] = [];
  const logger: Logger = {
    error: () => undefined,
    warn: (m) => {
      warns.push(m);
    },
    info: () => undefined,
    debug: () => undefined,
    devWarn: () => undefined,
    child: () => logger,
  };
  return { logger, warns };
};

describe('Time.fixed defaults', () => {
  it('is auto-registered with timestep = 1/60 and zeroed delta/elapsed/overstep', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const time = app.getResource(Time)!;
    expect(time.fixed.timestep).toBeCloseTo(1 / 60, 8);
    expect(time.fixed.delta).toBe(0);
    expect(time.fixed.elapsed).toBe(0);
    expect(time.fixed.overstep).toBe(0);
  });
});

describe('FixedMain loop', () => {
  it('runs exactly N substeps when virtual delta = N * timestep', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    let substeps = 0;
    let observedDelta = -1;
    app.addSystem('fixedUpdate', [], () => {
      substeps += 1;
    });
    app.addSystem('fixedUpdate', [ResMut(Time)], (time) => {
      observedDelta = time.fixed.delta;
    });

    // First frame: delta=0, no substeps.
    app.advanceFrame(0);
    expect(substeps).toBe(0);
    expect(app.getResource(Time)!.fixed.elapsed).toBe(0);

    // Second frame: ~50ms wall delta = 3 * (1/60s) substeps with a small overstep remaining.
    app.advanceFrame(50);
    expect(substeps).toBe(3);
    expect(observedDelta).toBeCloseTo(1 / 60, 8);
    expect(app.getResource(Time)!.fixed.elapsed).toBeCloseTo(3 / 60, 8);
    expect(app.getResource(Time)!.fixed.overstep).toBeGreaterThan(0);
    expect(app.getResource(Time)!.fixed.overstep).toBeLessThan(1 / 60);
  });

  it('sets time.fixed.delta = 0 between FixedMain runs (reads outside fixed* observe zero)', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    let updateDelta = -1;
    app.addSystem('update', [ResMut(Time)], (time) => {
      updateDelta = time.fixed.delta;
    });
    app.advanceFrame(0);
    app.advanceFrame(20);
    // After all fixed substeps complete, delta resets to 0 before `update` runs.
    expect(updateDelta).toBe(0);
  });

  it('runs the five fixed stages in order, once per substep', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const trace: string[] = [];
    app.addSystem('fixedFirst', [], () => trace.push('first'));
    app.addSystem('fixedPreUpdate', [], () => trace.push('pre'));
    app.addSystem('fixedUpdate', [], () => trace.push('update'));
    app.addSystem('fixedPostUpdate', [], () => trace.push('post'));
    app.addSystem('fixedLast', [], () => trace.push('last'));
    app.advanceFrame(0);
    app.advanceFrame(1000 / 60 + 1); // ~one substep
    expect(trace).toEqual(['first', 'pre', 'update', 'post', 'last']);
  });

  it('does not run substeps while virtual is paused', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    let substeps = 0;
    app.addSystem('fixedUpdate', [], () => {
      substeps += 1;
    });
    app.addSystem('first', [ResMut(Time)], (time) => {
      time.virtual.paused = true;
    });
    app.advanceFrame(0);
    app.advanceFrame(100);
    app.advanceFrame(200);
    expect(substeps).toBe(0);
    // Real clock still advances; fixed accumulator stays at 0 because virtual delta is 0.
    expect(app.getResource(Time)!.real.elapsed).toBeGreaterThan(0);
    expect(app.getResource(Time)!.fixed.overstep).toBe(0);
  });

  it('scales substep count with virtual.scale (half speed → half the substeps)', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    let substeps = 0;
    app.addSystem('fixedUpdate', [], () => {
      substeps += 1;
    });
    app.addSystem('first', [ResMut(Time)], (time) => {
      time.virtual.scale = 0.5;
    });
    app.advanceFrame(0);
    // ~50ms wall delta × 0.5 scale = ~25ms virtual = 1 full substep (1/60 ≈ 16.67ms).
    app.advanceFrame(50);
    expect(substeps).toBe(1);
  });

  it('caps substeps at 8 per frame and drops residual + warns via logger', () => {
    const spy = createSpyLogger();
    const app = new App({ renderer: makeHeadlessRenderer(), logger: spy.logger });
    let substeps = 0;
    app.addSystem('fixedUpdate', [], () => {
      substeps += 1;
    });

    // First frame seeds the lastMs in Time.tick.
    app.advanceFrame(0);
    // Time clamps multi-second hitches to 100ms internally, which at 1/60 timestep
    // is 6 substeps. To trigger the 8-substep cap we need to lower the timestep.
    app.addSystem('first', [ResMut(Time)], (time) => {
      time.fixed.timestep = 1 / 200; // 5ms → 100ms → 20 substeps without cap; capped at 8.
    });
    app.advanceFrame(2000);
    expect(substeps).toBe(8);
    expect(spy.warns).toHaveLength(1);
    expect(spy.warns[0]).toContain('FixedMain');
    // Residual dropped — overstep is 0 after the cap.
    expect(app.getResource(Time)!.fixed.overstep).toBe(0);
  });

  it('overstep advances toward timestep across frames without triggering a substep until it crosses', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    let substeps = 0;
    app.addSystem('fixedUpdate', [], () => {
      substeps += 1;
    });
    app.advanceFrame(0);

    // ~8ms — below 1/60 ≈ 16.67ms timestep. No substep.
    app.advanceFrame(8);
    expect(substeps).toBe(0);
    expect(app.getResource(Time)!.fixed.overstep).toBeGreaterThan(0);

    // Another ~10ms accumulates past the timestep. One substep fires.
    app.advanceFrame(18);
    expect(substeps).toBe(1);
  });

  it('non-positive timestep parks the loop without diverging', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    let substeps = 0;
    app.addSystem('fixedUpdate', [], () => {
      substeps += 1;
    });
    app.addSystem('first', [ResMut(Time)], (time) => {
      time.fixed.timestep = 0;
    });
    app.advanceFrame(0);
    app.advanceFrame(100);
    expect(substeps).toBe(0);
    expect(app.getResource(Time)!.fixed.delta).toBe(0);
  });
});
