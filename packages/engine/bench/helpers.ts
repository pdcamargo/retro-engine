// Shared bench scaffolding: headless renderer stub and silent logger so the
// `App` constructor and `propagateTransforms*` calls don't try to talk to a
// GPU or pollute the bench output with devWarn lines.
// See docs/adr/ADR-0017.

import type {
  CommandBuffer,
  CommandEncoder,
  Renderer,
  RendererCapabilities,
  RenderPipeline,
  ShaderModule,
  Surface,
  TextureFormat,
} from '@retro-engine/renderer-core';

import type { Logger } from '@retro-engine/engine';

const fail = (msg: string): never => {
  throw new Error(`bench renderer: ${msg} not implemented`);
};

const baseCapabilities: RendererCapabilities = {
  computeShaders: false,
  storageTextures: false,
  timestampQueries: false,
  indirectDraw: false,
  bgra8UnormStorage: false,
};

export const makeHeadlessRenderer = (): Renderer => ({
  capabilities: baseCapabilities,
  init: () => Promise.resolve(),
  destroy: () => undefined,
  getPreferredSurfaceFormat: (): TextureFormat => 'rgba8unorm',
  createSurface: (): Surface => fail('createSurface'),
  createShaderModule: (): ShaderModule => fail('createShaderModule'),
  createRenderPipeline: (): RenderPipeline => fail('createRenderPipeline'),
  createCommandEncoder: (): CommandEncoder => fail('createCommandEncoder'),
  submit: (_buffers: CommandBuffer[]): void => fail('submit'),
});

export const silentLogger: Logger = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
  devWarn: () => {},
  child(): Logger {
    return silentLogger;
  },
};
