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

import { App, Res, ResMut, Time } from './index';

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

describe('Time resource', () => {
  it('is auto-registered on App construction with zeroed clocks', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const time = app.getResource(Time);
    expect(time).toBeInstanceOf(Time);
    expect(time?.frame).toBe(0);
    expect(time?.virtual.delta).toBe(0);
    expect(time?.virtual.elapsed).toBe(0);
    expect(time?.virtual.paused).toBe(false);
    expect(time?.virtual.scale).toBe(1);
    expect(time?.real.delta).toBe(0);
    expect(time?.real.elapsed).toBe(0);
  });

  it('emits delta = 0 on the first frame for both clocks', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    app.advanceFrame(1000);
    const time = app.getResource(Time)!;
    expect(time.frame).toBe(1);
    expect(time.virtual.delta).toBe(0);
    expect(time.real.delta).toBe(0);
    expect(time.virtual.elapsed).toBe(0);
    expect(time.real.elapsed).toBe(0);
  });

  it('reflects the gap between two timestamps on the second frame', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    app.advanceFrame(1000);
    app.advanceFrame(1016.67);
    const time = app.getResource(Time)!;
    expect(time.frame).toBe(2);
    expect(time.virtual.delta).toBeCloseTo(0.01667, 5);
    expect(time.real.delta).toBeCloseTo(0.01667, 5);
    expect(time.virtual.elapsed).toBeCloseTo(0.01667, 5);
    expect(time.real.elapsed).toBeCloseTo(0.01667, 5);
  });

  it('freezes virtual.delta to 0 and stops virtual.elapsed advancing while paused; real continues', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    app.addSystem('update', [ResMut(Time)], (time) => {
      time.virtual.paused = true;
    });
    app.advanceFrame(1000);
    app.advanceFrame(1016);
    app.advanceFrame(1032);
    const time = app.getResource(Time)!;
    expect(time.virtual.delta).toBe(0);
    expect(time.virtual.elapsed).toBe(0);
    expect(time.real.delta).toBeCloseTo(0.016, 5);
    expect(time.real.elapsed).toBeCloseTo(0.032, 5);
    expect(time.frame).toBe(3);
  });

  it('scales virtual.delta but leaves real.delta untouched', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    app.addSystem('update', [ResMut(Time)], (time) => {
      time.virtual.scale = 0.5;
    });
    app.advanceFrame(1000);
    app.advanceFrame(1016.67);
    const time = app.getResource(Time)!;
    expect(time.virtual.delta).toBeCloseTo(0.00833, 5);
    expect(time.real.delta).toBeCloseTo(0.01667, 5);
    expect(time.virtual.elapsed).toBeCloseTo(0.00833, 5);
    expect(time.real.elapsed).toBeCloseTo(0.01667, 5);
  });

  it('increments frame monotonically even across pauses', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    app.addSystem('update', [ResMut(Time)], (time) => {
      time.virtual.paused = true;
    });
    app.advanceFrame(0);
    app.advanceFrame(16);
    app.advanceFrame(32);
    app.advanceFrame(48);
    const time = app.getResource(Time)!;
    expect(time.frame).toBe(4);
    expect(time.virtual.delta).toBe(0);
  });

  it('clamps a multi-second timestamp gap to 100ms', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    app.advanceFrame(0);
    app.advanceFrame(5000);
    const time = app.getResource(Time)!;
    expect(time.real.delta).toBe(0.1);
    expect(time.virtual.delta).toBe(0.1);
    expect(time.real.elapsed).toBe(0.1);
    expect(time.virtual.elapsed).toBe(0.1);
  });

  it('Res(Time) resolves cleanly and exposes the live clock', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    let observedFrame = -1;
    let observedDelta = -1;
    app.addSystem('update', [Res(Time)], (time) => {
      observedFrame = time.frame;
      observedDelta = time.virtual.delta;
    });
    app.advanceFrame(0);
    app.advanceFrame(16.67);
    expect(observedFrame).toBe(2);
    expect(observedDelta).toBeCloseTo(0.01667, 5);
  });

  it('ResMut(Time) allows mutating pause and scale at runtime', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    let toggled = false;
    app.addSystem('update', [ResMut(Time)], (time) => {
      if (!toggled) {
        time.virtual.paused = true;
        time.virtual.scale = 0.25;
        toggled = true;
      }
    });
    app.advanceFrame(0);
    const time = app.getResource(Time)!;
    expect(time.virtual.paused).toBe(true);
    expect(time.virtual.scale).toBe(0.25);
  });

  it('Res<Time> forbids mutations to sub-clock fields at the type level', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    app.addSystem('update', [Res(Time)], (time) => {
      // @ts-expect-error — write to virtual.paused through Res<Time> is a compile error
      time.virtual.paused = true;
      // @ts-expect-error — write to virtual.scale through Res<Time> is a compile error
      time.virtual.scale = 2;
      // @ts-expect-error — write to virtual.delta through Res<Time> is a compile error
      time.virtual.delta = 1;
      // @ts-expect-error — write to virtual.elapsed through Res<Time> is a compile error
      time.virtual.elapsed = 1;
      // @ts-expect-error — write to real.delta through Res<Time> is a compile error
      time.real.delta = 1;
      // @ts-expect-error — write to real.elapsed through Res<Time> is a compile error
      time.real.elapsed = 1;
      // @ts-expect-error — write to frame through Res<Time> is a compile error
      time.frame = 0;
    });
    app.advanceFrame(0);
  });
});
