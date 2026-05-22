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

import { App, RunCondition } from './index';

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

describe('Stage union', () => {
  it('runs the Main schedule in order: first → startup (first frame only) → preUpdate → update → postUpdate → last', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const trace: string[] = [];
    app.addSystem('first', [], () => trace.push('first'));
    app.addSystem('startup', [], () => trace.push('startup'));
    app.addSystem('preUpdate', [], () => trace.push('preUpdate'));
    app.addSystem('update', [], () => trace.push('update'));
    app.addSystem('postUpdate', [], () => trace.push('postUpdate'));
    app.addSystem('last', [], () => trace.push('last'));

    app.advanceFrame(0);
    expect(trace).toEqual(['first', 'startup', 'preUpdate', 'update', 'postUpdate', 'last']);

    trace.length = 0;
    app.advanceFrame(16);
    // Startup is first-frame only — second frame skips it.
    expect(trace).toEqual(['first', 'preUpdate', 'update', 'postUpdate', 'last']);
  });

  it('exposes the new fixed* stages on the Stage union (smoke registration)', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    // Registering against each fixed* name does not throw; until the fixed
    // driver lands, these stages are simply not driven each frame.
    expect(() => app.addSystem('fixedFirst', [], () => undefined)).not.toThrow();
    expect(() => app.addSystem('fixedPreUpdate', [], () => undefined)).not.toThrow();
    expect(() => app.addSystem('fixedUpdate', [], () => undefined)).not.toThrow();
    expect(() => app.addSystem('fixedPostUpdate', [], () => undefined)).not.toThrow();
    expect(() => app.addSystem('fixedLast', [], () => undefined)).not.toThrow();
  });
});

describe('Ordering within a stage', () => {
  it('respects before / after / label constraints', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const trace: string[] = [];
    // Register in shuffled order; topo sort must put them back as input → motion → collision.
    app.addSystem('update', [], () => trace.push('collision'), { after: ['motion'] });
    app.addSystem('update', [], () => trace.push('motion'), {
      label: 'motion',
      after: ['input'],
    });
    app.addSystem('update', [], () => trace.push('input'), { label: 'input' });

    app.advanceFrame(0);
    expect(trace).toEqual(['input', 'motion', 'collision']);
  });

  it('falls back to registration order among nodes with no constraints', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const trace: string[] = [];
    app.addSystem('update', [], () => trace.push('a'));
    app.addSystem('update', [], () => trace.push('b'));
    app.addSystem('update', [], () => trace.push('c'));

    app.advanceFrame(0);
    expect(trace).toEqual(['a', 'b', 'c']);
  });

  it('allows forward references to labels registered later', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const trace: string[] = [];
    app.addSystem('update', [], () => trace.push('depends-on-later'), { after: ['later'] });
    app.addSystem('update', [], () => trace.push('later'), { label: 'later' });

    app.advanceFrame(0);
    expect(trace).toEqual(['later', 'depends-on-later']);
  });

  it('ignores constraints that reference no matching label', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const trace: string[] = [];
    app.addSystem('update', [], () => trace.push('a'), { before: ['nonexistent'] });
    app.addSystem('update', [], () => trace.push('b'));

    expect(() => app.advanceFrame(0)).not.toThrow();
    expect(trace).toEqual(['a', 'b']);
  });

  it('throws at registration when a cycle is introduced; offending registration is rolled back', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    let aRan = 0;
    let bRan = 0;
    app.addSystem(
      'update',
      [],
      () => {
        aRan += 1;
      },
      { label: 'a', after: ['b'] },
    );
    expect(() =>
      app.addSystem(
        'update',
        [],
        () => {
          bRan += 1;
        },
        { label: 'b', after: ['a'] },
      ),
    ).toThrow(/ordering cycle/);

    // After the throw, only system 'a' remains; it still runs.
    app.advanceFrame(0);
    expect(aRan).toBe(1);
    expect(bRan).toBe(0);
  });

  it('cycle detection is per-stage — same labels in different stages do not interact', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const trace: string[] = [];
    app.addSystem('update', [], () => trace.push('u-foo'), { label: 'foo' });
    app.addSystem('postUpdate', [], () => trace.push('pu-foo'), { label: 'foo' });
    app.addSystem('postUpdate', [], () => trace.push('pu-bar'), { after: ['foo'] });

    app.advanceFrame(0);
    expect(trace).toEqual(['u-foo', 'pu-foo', 'pu-bar']);
  });

  it('honours runIf gating alongside ordering', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const trace: string[] = [];
    app.addSystem('update', [], () => trace.push('a'), { label: 'a' });
    app.addSystem('update', [], () => trace.push('b-skipped'), {
      after: ['a'],
      runIf: new RunCondition(() => false),
    });
    app.addSystem('update', [], () => trace.push('c'), { after: ['a'] });

    app.advanceFrame(0);
    expect(trace).toEqual(['a', 'c']);
  });
});
