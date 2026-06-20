import type { AssetIndex, Handle } from '@retro-engine/assets';
import {
  type BindGroupLayout,
  type Buffer,
  BufferUsage,
  type PipelineLayout,
  type RenderPipeline,
  type Sampler,
  type ShaderModule,
  ShaderStage,
  type Texture,
  type TextureFormat,
  type TextureView,
  TextureUsage,
} from '@retro-engine/renderer-core';

import type { Image } from '../image/image';
import type { RenderImage } from '../image/render-image';
import type { App } from '../index';
import { PipelineCache } from '../shader/pipeline-cache';
import { Shader } from '../shader/shader';
import { ShaderRegistry } from '../shader/shader-registry';

import { EQUIRECT_TO_CUBE_WGSL } from './equirect-to-cube.wgsl';

const CUBE_FORMAT: TextureFormat = 'rgba16float';
/** Edge length of each derived cube face when converting an equirectangular source. */
const CUBE_FACE_SIZE = 1024;
const PARAMS_BYTES = 16;

/** A cube derived from an equirectangular source. */
interface DerivedCube {
  readonly texture: Texture;
  readonly view: TextureView;
}

/**
 * Render-world cache of cubes converted from equirectangular sources, keyed by
 * the source image's {@link AssetIndex}. Derived — never serialized.
 *
 * @internal
 */
export class RenderEnvironmentCubes {
  private readonly entries = new Map<AssetIndex, DerivedCube>();

  get(index: AssetIndex): DerivedCube | undefined {
    return this.entries.get(index);
  }

  set(index: AssetIndex, cube: DerivedCube): void {
    this.entries.set(index, cube);
  }

  dispose(): void {
    for (const cube of this.entries.values()) cube.texture.destroy();
    this.entries.clear();
  }
}

/**
 * Render-world resource that converts an equirectangular 2D texture into a
 * cubemap via six fullscreen render passes (one per face). Shared by the skybox
 * and the IBL prefilter so an equirectangular `.hdr` becomes a regular cube
 * source for both.
 *
 * @internal
 */
export class EnvironmentCubeConverter {
  /** Sampler used to bind a converted cube at shade time (linear, clamp). */
  sampler: Sampler | undefined;

  private layout: BindGroupLayout | undefined;
  private pipelineLayout: PipelineLayout | undefined;
  private shaderModule: ShaderModule | undefined;
  private pipeline: RenderPipeline | undefined;
  private paramsBuffer: Buffer | undefined;
  private readonly paramsScratch = new Float32Array(4);
  private equirectSampler: Sampler | undefined;
  private initialised = false;

  ensureInitialised(app: App): boolean {
    if (this.initialised) return true;
    const renderer = app.renderer;
    const pipelineCache = app.getResource(PipelineCache);
    const registry = app.getResource(ShaderRegistry);
    if (pipelineCache === undefined || registry === undefined) return false;
    const source = registry.get('retro_engine::equirect_to_cube');
    if (source === undefined) return false;

    this.equirectSampler = renderer.createSampler({
      label: 'equirect-sampler',
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'repeat',
      addressModeV: 'clamp-to-edge',
    });
    this.sampler = renderer.createSampler({
      label: 'environment-cube-sampler',
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
      addressModeW: 'clamp-to-edge',
    });
    this.paramsBuffer = renderer.createBuffer({
      label: 'equirect-to-cube-params',
      size: PARAMS_BYTES,
      usage: BufferUsage.UNIFORM | BufferUsage.COPY_DST,
    });
    this.layout = renderer.createBindGroupLayout({
      label: 'equirect-to-cube-layout',
      entries: [
        { binding: 0, visibility: ShaderStage.FRAGMENT, buffer: { type: 'uniform', minBindingSize: PARAMS_BYTES } },
        { binding: 1, visibility: ShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d' } },
        { binding: 2, visibility: ShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      ],
    });
    this.pipelineLayout = renderer.createPipelineLayout({
      label: 'equirect-to-cube-pipeline-layout',
      bindGroupLayouts: [this.layout],
    });
    this.shaderModule = pipelineCache.compileShader(
      new Shader(source, { label: 'retro_engine::equirect_to_cube' }),
    );
    this.pipeline = renderer.createRenderPipeline({
      label: 'equirect-to-cube',
      layout: this.pipelineLayout,
      vertex: { module: this.shaderModule, entryPoint: 'vs_main', buffers: [] },
      fragment: { module: this.shaderModule, entryPoint: 'fs_main', targets: [{ format: CUBE_FORMAT }] },
      primitive: { topology: 'triangle-list', cullMode: 'none', frontFace: 'ccw' },
    });
    this.initialised = true;
    return true;
  }

  /** Convert an equirectangular view into a cube (six face renders). */
  convert(app: App, equirectView: TextureView): DerivedCube {
    const renderer = app.renderer;
    if (this.layout === undefined || this.equirectSampler === undefined || this.paramsBuffer === undefined) {
      throw new Error('EnvironmentCubeConverter.convert: not initialised.');
    }
    const texture = renderer.createTexture({
      label: 'environment-cube',
      width: CUBE_FACE_SIZE,
      height: CUBE_FACE_SIZE,
      depthOrArrayLayers: 6,
      format: CUBE_FORMAT,
      usage: TextureUsage.RENDER_ATTACHMENT | TextureUsage.TEXTURE_BINDING,
    });
    const bindGroup = renderer.createBindGroup({
      label: 'equirect-to-cube-source',
      layout: this.layout,
      entries: [
        { binding: 0, resource: { buffer: this.paramsBuffer } },
        { binding: 1, resource: equirectView },
        { binding: 2, resource: this.equirectSampler },
      ],
    });
    for (let face = 0; face < 6; face++) {
      this.paramsScratch[0] = face;
      renderer.writeBuffer(this.paramsBuffer, 0, this.paramsScratch as unknown as BufferSource);
      const faceView = texture.createView({
        label: `environment-cube-face#${face}`,
        dimension: '2d',
        baseArrayLayer: face,
        arrayLayerCount: 1,
      });
      const encoder = renderer.createCommandEncoder(`equirect-to-cube#${face}`);
      const pass = encoder.beginRenderPass({
        label: `equirect-to-cube#${face}`,
        colorAttachments: [{ view: faceView, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
      });
      pass.setPipeline(this.pipeline!);
      pass.setBindGroup(0, bindGroup);
      pass.draw(3, 1, 0, 0);
      pass.end();
      renderer.submit([encoder.finish()]);
    }
    bindGroup.destroy();
    return { texture, view: texture.createView({ label: 'environment-cube#view', dimension: 'cube' }) };
  }

  dispose(): void {
    this.sampler = undefined;
    this.equirectSampler = undefined;
    this.paramsBuffer = undefined;
    this.layout = undefined;
    this.pipelineLayout = undefined;
    this.shaderModule = undefined;
    this.pipeline = undefined;
    this.initialised = false;
  }
}

/** A cube view + the sampler to bind it with, resolved from an environment source. */
export interface ResolvedEnvironmentCube {
  readonly view: TextureView;
  readonly sampler: Sampler;
}

/**
 * Ensure the shared equirect→cube conversion resources exist. Called from both
 * `SkyboxPlugin` and `EnvironmentMapPlugin` build so either works standalone;
 * registering the shader is idempotent.
 */
export const ensureEnvironmentCubeResources = (app: App): void => {
  const registry = app.getResource(ShaderRegistry);
  if (registry !== undefined && !registry.has('retro_engine::equirect_to_cube')) {
    registry.register('retro_engine::equirect_to_cube', EQUIRECT_TO_CUBE_WGSL);
  }
  if (app.getResource(EnvironmentCubeConverter) === undefined) {
    app.insertResource(new EnvironmentCubeConverter());
  }
  if (app.getResource(RenderEnvironmentCubes) === undefined) {
    app.insertResource(new RenderEnvironmentCubes());
  }
};

/**
 * Resolve an environment source to a cube view + sampler. Cube sources pass
 * through directly; equirectangular (`'2d'`) sources are converted once and
 * cached. Returns `undefined` when an equirect source cannot be converted yet
 * (converter not initialised).
 */
export const resolveEnvironmentCubeView = (
  app: App,
  handle: Handle<Image>,
  renderImage: RenderImage,
): ResolvedEnvironmentCube | undefined => {
  if (renderImage.dimension === 'cube') {
    return { view: renderImage.view, sampler: renderImage.sampler };
  }
  const converter = app.getResource(EnvironmentCubeConverter);
  const cubes = app.getResource(RenderEnvironmentCubes);
  if (converter === undefined || cubes === undefined) return undefined;
  if (!converter.ensureInitialised(app) || converter.sampler === undefined) return undefined;
  let cube = cubes.get(handle.index);
  if (cube === undefined) {
    cube = converter.convert(app, renderImage.view);
    cubes.set(handle.index, cube);
  }
  return { view: cube.view, sampler: converter.sampler };
};
