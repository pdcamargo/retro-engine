import { describe, expect, it } from 'bun:test';

import { App, inState } from '@retro-engine/engine';
import type {
  BufferDescriptor,
  Renderer,
  RendererCapabilities,
  TextureDescriptor,
  TextureFormat,
} from '@retro-engine/renderer-core';

import { currentSimState, initSimState, requestSimState, SimState } from './sim-state';
import { installSimStep, requestSimStep, simStepActive } from './sim-step';

const capabilities: RendererCapabilities = {
  computeShaders: false,
  storageTextures: false,
  timestampQueries: false,
  indirectDraw: false,
  bgra8UnormStorage: false,
  baseVertex: true,
  storageBuffers: true,
};

/** Inert renderer so `App.advanceFrame()` runs end-to-end without a GPU. */
const makeStubRenderer = (): Renderer => {
  const view = { destroy: () => undefined };
  const pass = {
    setPipeline: () => undefined,
    setBindGroup: () => undefined,
    setVertexBuffer: () => undefined,
    setIndexBuffer: () => undefined,
    draw: () => undefined,
    drawIndexed: () => undefined,
    setStencilReference: () => undefined,
    end: () => undefined,
  };
  const surface = {
    configure: () => undefined,
    resize: () => undefined,
    getCurrentTextureView: () => view,
    get format(): TextureFormat {
      return 'rgba8unorm';
    },
    get width(): number {
      return 640;
    },
    get height(): number {
      return 480;
    },
    destroy: () => undefined,
  };
  return {
    capabilities,
    init: () => Promise.resolve(),
    destroy: () => undefined,
    getPreferredSurfaceFormat: (): TextureFormat => 'rgba8unorm',
    createSurface: () => surface,
    createShaderModule: () => ({ destroy: () => undefined }),
    createBuffer: (d: BufferDescriptor) => ({ size: d.size, usage: d.usage, destroy: () => undefined }),
    createTexture: (d: TextureDescriptor) => ({
      width: d.width,
      height: d.height,
      depthOrArrayLayers: d.depthOrArrayLayers ?? 1,
      format: d.format,
      mipLevelCount: d.mipLevelCount ?? 1,
      sampleCount: d.sampleCount ?? 1,
      usage: d.usage,
      createView: () => view,
      destroy: () => undefined,
    }),
    createSampler: () => ({ destroy: () => undefined }),
    writeBuffer: () => undefined,
    writeTexture: () => undefined,
    createBindGroupLayout: () => ({ destroy: () => undefined }),
    createPipelineLayout: () => ({ destroy: () => undefined }),
    createBindGroup: () => ({ destroy: () => undefined }),
    createRenderPipeline: () => ({ destroy: () => undefined }),
    createCommandEncoder: () => ({ beginRenderPass: () => pass, finish: () => ({ destroy: () => undefined }) }),
    resolveRenderTarget: () => ({ view, format: 'rgba8unorm', width: 640, height: 480 }),
    submit: () => undefined,
  } as unknown as Renderer;
};

/**
 * Build an App with `SimState` + step wiring and a single "gameplay" system
 * gated exactly like the studio's project systems: `inState(Play).or(step)`.
 * The system bumps `runs.n` each time it fires, so tests can count frames.
 */
const setup = () => {
  const app = new App({ renderer: makeStubRenderer() });
  initSimState(app);
  installSimStep(app);
  const runs = { n: 0 };
  app.addSystem('update', [], () => runs.n++, {
    name: 'gameplay',
    runIf: inState(SimState.Play).or(simStepActive()),
  });
  return { app, runs };
};

describe('play-mode step', () => {
  it('freezes gameplay while paused and advances exactly one frame per step', () => {
    const { app, runs } = setup();

    // Frame 1 applies the initial Edit state; gameplay stays frozen in Edit.
    app.advanceFrame(0);
    expect(currentSimState(app)).toBe(SimState.Edit);
    expect(runs.n).toBe(0);

    // Enter Play → gameplay runs every frame.
    requestSimState(app, SimState.Play);
    app.advanceFrame(16); // transition applies this frame, then gameplay runs
    app.advanceFrame(16);
    expect(runs.n).toBe(2);

    // Pause → gameplay freezes.
    requestSimState(app, SimState.Paused);
    app.advanceFrame(16); // transition applies; gameplay gated off
    app.advanceFrame(16);
    const pausedRuns = runs.n;
    expect(currentSimState(app)).toBe(SimState.Paused);
    expect(runs.n).toBe(pausedRuns); // no growth while paused

    // Step once → gameplay runs for exactly one frame, then freezes again.
    requestSimStep(app);
    app.advanceFrame(16);
    expect(runs.n).toBe(pausedRuns + 1);
    app.advanceFrame(16);
    expect(runs.n).toBe(pausedRuns + 1); // frozen again — the step was one frame

    // A second step advances one more frame.
    requestSimStep(app);
    app.advanceFrame(16);
    expect(runs.n).toBe(pausedRuns + 2);
  });

  it('requestSimStep is a no-op unless paused', () => {
    const { app, runs } = setup();
    app.advanceFrame(0); // Edit

    // In Edit, a step request does nothing.
    requestSimStep(app);
    app.advanceFrame(16);
    app.advanceFrame(16);
    expect(runs.n).toBe(0);

    // In Play, gameplay already advances; a step request adds no extra frame.
    requestSimState(app, SimState.Play);
    app.advanceFrame(16); // transition
    const beforeStep = runs.n;
    requestSimStep(app);
    app.advanceFrame(16);
    expect(runs.n).toBe(beforeStep + 1); // one frame's worth, not two
  });
});
