import type { AssetIndex } from '@retro-engine/assets';
import {
  type BindGroup,
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

import type { App } from '../index';
import { PipelineCache } from '../shader/pipeline-cache';
import { Shader } from '../shader/shader';
import { ShaderRegistry } from '../shader/shader-registry';

/** Half-float color format the prefiltered cubes are stored in. */
const ENV_FORMAT: TextureFormat = 'rgba16float';
/** Two-channel format for the BRDF integration LUT (scale + bias). */
const BRDF_FORMAT: TextureFormat = 'rg16float';

/** Edge length of the diffuse irradiance cube faces. */
const IRRADIANCE_SIZE = 32;
/** Edge length of the specular prefilter cube's mip 0. */
const SPECULAR_SIZE = 128;
/** Specular roughness mip count; mip `m` holds roughness `m / (SPECULAR_MIPS - 1)`. */
const SPECULAR_MIPS = 5;
/** Edge length of the (environment-independent) BRDF LUT. */
const BRDF_SIZE = 256;

const PARAMS_BYTES = 16;

/** A prefiltered environment's GPU resources. Derived — never serialized. */
export interface PrefilteredEnvironment {
  readonly irradianceTexture: Texture;
  /** Cube view of the diffuse irradiance map. */
  readonly irradianceView: TextureView;
  readonly specularTexture: Texture;
  /** Cube view of the roughness-mipped specular map. */
  readonly specularView: TextureView;
  /** Highest specular mip index (`SPECULAR_MIPS - 1`); shade-time LOD = roughness × this. */
  readonly maxMip: number;
}

/**
 * Render-world cache of prefiltered environments, keyed by the source image's
 * {@link AssetIndex}. Populated by {@link EnvironmentPrefilter}; entries are
 * derived GPU resources rebuilt on demand and **never serialized** (the source
 * `Handle<Image>` on the authored component is the persistent identity).
 *
 * @internal
 */
export class RenderEnvironmentMaps {
  private readonly entries = new Map<AssetIndex, PrefilteredEnvironment>();

  get(index: AssetIndex): PrefilteredEnvironment | undefined {
    return this.entries.get(index);
  }

  has(index: AssetIndex): boolean {
    return this.entries.has(index);
  }

  set(index: AssetIndex, env: PrefilteredEnvironment): void {
    this.entries.set(index, env);
  }

  delete(index: AssetIndex): void {
    const existing = this.entries.get(index);
    if (existing === undefined) return;
    existing.irradianceTexture.destroy();
    existing.specularTexture.destroy();
    this.entries.delete(index);
  }

  dispose(): void {
    for (const env of this.entries.values()) {
      env.irradianceTexture.destroy();
      env.specularTexture.destroy();
    }
    this.entries.clear();
  }
}

/**
 * Render-world resource owning the IBL prefilter bake: the irradiance,
 * specular, and BRDF-LUT pipelines, their shared sampler / param buffer, and
 * the environment-independent BRDF LUT (baked once on init).
 *
 * The bake runs as standalone command submissions in `RenderSet.Prepare` (one
 * submit per cube face / mip), not inside the frame's render graph — it is a
 * one-time cost per source image, gated on `RendererCapabilities` nothing
 * special (render-pass based, no compute), so it is WebGL2-reachable.
 *
 * @internal
 */
export class EnvironmentPrefilter {
  /** Cube view of the BRDF LUT's owning 2D texture. Built once on init. */
  brdfLutView: TextureView | undefined;
  /** Sampler used to bind all three prefiltered maps at shade time (linear, clamp). */
  sampler: Sampler | undefined;

  private brdfLut: Texture | undefined;
  private layout: BindGroupLayout | undefined;
  private prefilterPipelineLayout: PipelineLayout | undefined;
  private shaderModule: ShaderModule | undefined;
  private irradiancePipeline: RenderPipeline | undefined;
  private specularPipeline: RenderPipeline | undefined;
  private brdfPipeline: RenderPipeline | undefined;
  private paramsBuffer: Buffer | undefined;
  private readonly paramsScratch = new Float32Array(4);
  private initialised = false;

  /**
   * Lazy GPU bootstrap: compile the prefilter shader, build the three
   * pipelines + shared sampler, and bake the BRDF LUT (once). Idempotent;
   * returns `false` until `PipelineCache` / `ShaderRegistry` are present.
   */
  ensureInitialised(app: App): boolean {
    if (this.initialised) return true;
    const renderer = app.renderer;
    const pipelineCache = app.getResource(PipelineCache);
    const registry = app.getResource(ShaderRegistry);
    if (pipelineCache === undefined || registry === undefined) return false;
    const source = registry.get('retro_engine::environment_prefilter');
    if (source === undefined) {
      throw new Error(
        "EnvironmentPrefilter: shader 'retro_engine::environment_prefilter' not registered; EnvironmentMapPlugin must register it on build.",
      );
    }

    this.sampler = renderer.createSampler({
      label: 'env-prefilter-sampler',
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
      addressModeW: 'clamp-to-edge',
    });
    this.paramsBuffer = renderer.createBuffer({
      label: 'env-prefilter-params',
      size: PARAMS_BYTES,
      usage: BufferUsage.UNIFORM | BufferUsage.COPY_DST,
    });
    this.layout = renderer.createBindGroupLayout({
      label: 'env-prefilter-layout',
      entries: [
        { binding: 0, visibility: ShaderStage.FRAGMENT, buffer: { type: 'uniform', minBindingSize: PARAMS_BYTES } },
        { binding: 1, visibility: ShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: 'cube' } },
        { binding: 2, visibility: ShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      ],
    });
    this.prefilterPipelineLayout = renderer.createPipelineLayout({
      label: 'env-prefilter-pipeline-layout',
      bindGroupLayouts: [this.layout],
    });
    this.shaderModule = pipelineCache.compileShader(
      new Shader(source, { label: 'retro_engine::environment_prefilter' }),
    );

    this.irradiancePipeline = renderer.createRenderPipeline({
      label: 'env-irradiance',
      layout: this.prefilterPipelineLayout,
      vertex: { module: this.shaderModule, entryPoint: 'vs_main', buffers: [] },
      fragment: { module: this.shaderModule, entryPoint: 'fs_irradiance', targets: [{ format: ENV_FORMAT }] },
      primitive: { topology: 'triangle-list', cullMode: 'none', frontFace: 'ccw' },
    });
    this.specularPipeline = renderer.createRenderPipeline({
      label: 'env-specular',
      layout: this.prefilterPipelineLayout,
      vertex: { module: this.shaderModule, entryPoint: 'vs_main', buffers: [] },
      fragment: { module: this.shaderModule, entryPoint: 'fs_prefilter', targets: [{ format: ENV_FORMAT }] },
      primitive: { topology: 'triangle-list', cullMode: 'none', frontFace: 'ccw' },
    });
    // fs_brdf reads neither params nor the source cube, so it needs no bind
    // groups — an empty pipeline layout keeps it independent of any environment.
    const brdfLayout = renderer.createPipelineLayout({
      label: 'env-brdf-pipeline-layout',
      bindGroupLayouts: [],
    });
    this.brdfPipeline = renderer.createRenderPipeline({
      label: 'env-brdf',
      layout: brdfLayout,
      vertex: { module: this.shaderModule, entryPoint: 'vs_main', buffers: [] },
      fragment: { module: this.shaderModule, entryPoint: 'fs_brdf', targets: [{ format: BRDF_FORMAT }] },
      primitive: { topology: 'triangle-list', cullMode: 'none', frontFace: 'ccw' },
    });

    this.brdfLut = renderer.createTexture({
      label: 'env-brdf-lut',
      width: BRDF_SIZE,
      height: BRDF_SIZE,
      format: BRDF_FORMAT,
      usage: TextureUsage.RENDER_ATTACHMENT | TextureUsage.TEXTURE_BINDING,
    });
    this.brdfLutView = this.brdfLut.createView({ label: 'env-brdf-lut#view' });
    this.bakeBrdf(app);

    this.initialised = true;
    return true;
  }

  /**
   * Bake a source cube into a diffuse irradiance map + a specular roughness mip
   * chain. Returns the GPU resources; the caller owns caching / disposal. Must
   * be initialised first.
   */
  bakeEnvironment(app: App, sourceCubeView: TextureView): PrefilteredEnvironment {
    const renderer = app.renderer;
    if (this.layout === undefined || this.sampler === undefined || this.paramsBuffer === undefined) {
      throw new Error('EnvironmentPrefilter.bakeEnvironment: not initialised.');
    }

    const sourceBindGroup = renderer.createBindGroup({
      label: 'env-prefilter-source',
      layout: this.layout,
      entries: [
        { binding: 0, resource: { buffer: this.paramsBuffer } },
        { binding: 1, resource: sourceCubeView },
        { binding: 2, resource: this.sampler },
      ],
    });

    const irradianceTexture = renderer.createTexture({
      label: 'env-irradiance-cube',
      width: IRRADIANCE_SIZE,
      height: IRRADIANCE_SIZE,
      depthOrArrayLayers: 6,
      format: ENV_FORMAT,
      usage: TextureUsage.RENDER_ATTACHMENT | TextureUsage.TEXTURE_BINDING,
    });
    for (let face = 0; face < 6; face++) {
      this.runFacePass(app, this.irradiancePipeline!, sourceBindGroup, irradianceTexture, face, 0, face, 0);
    }

    const specularTexture = renderer.createTexture({
      label: 'env-specular-cube',
      width: SPECULAR_SIZE,
      height: SPECULAR_SIZE,
      depthOrArrayLayers: 6,
      format: ENV_FORMAT,
      mipLevelCount: SPECULAR_MIPS,
      usage: TextureUsage.RENDER_ATTACHMENT | TextureUsage.TEXTURE_BINDING,
    });
    for (let mip = 0; mip < SPECULAR_MIPS; mip++) {
      const roughness = SPECULAR_MIPS > 1 ? mip / (SPECULAR_MIPS - 1) : 0;
      for (let face = 0; face < 6; face++) {
        this.runFacePass(app, this.specularPipeline!, sourceBindGroup, specularTexture, face, mip, face, roughness);
      }
    }

    sourceBindGroup.destroy();

    return {
      irradianceTexture,
      irradianceView: irradianceTexture.createView({ label: 'env-irradiance#view', dimension: 'cube' }),
      specularTexture,
      specularView: specularTexture.createView({ label: 'env-specular#view', dimension: 'cube' }),
      maxMip: SPECULAR_MIPS - 1,
    };
  }

  /** Drop every GPU resource. Tests call this on teardown. */
  dispose(): void {
    this.brdfLut?.destroy();
    this.brdfLut = undefined;
    this.brdfLutView = undefined;
    this.sampler = undefined;
    this.paramsBuffer = undefined;
    this.layout = undefined;
    this.prefilterPipelineLayout = undefined;
    this.shaderModule = undefined;
    this.irradiancePipeline = undefined;
    this.specularPipeline = undefined;
    this.brdfPipeline = undefined;
    this.initialised = false;
  }

  /** Render one cube face/mip in its own submission, with the params set for it. */
  private runFacePass(
    app: App,
    pipeline: RenderPipeline,
    bindGroup: BindGroup,
    target: Texture,
    face: number,
    mip: number,
    faceParam: number,
    roughness: number,
  ): void {
    const renderer = app.renderer;
    this.paramsScratch[0] = faceParam;
    this.paramsScratch[1] = roughness;
    this.paramsScratch[2] = 0;
    this.paramsScratch[3] = 0;
    renderer.writeBuffer(this.paramsBuffer!, 0, this.paramsScratch as unknown as BufferSource);

    const view = target.createView({
      label: `env-prefilter-target#f${face}m${mip}`,
      dimension: '2d',
      baseArrayLayer: face,
      arrayLayerCount: 1,
      baseMipLevel: mip,
      mipLevelCount: 1,
    });
    const encoder = renderer.createCommandEncoder(`env-prefilter#f${face}m${mip}`);
    const pass = encoder.beginRenderPass({
      label: `env-prefilter#f${face}m${mip}`,
      colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3, 1, 0, 0);
    pass.end();
    renderer.submit([encoder.finish()]);
  }

  /** Bake the environment-independent BRDF LUT once. */
  private bakeBrdf(app: App): void {
    const renderer = app.renderer;
    const encoder = renderer.createCommandEncoder('env-brdf-bake');
    const pass = encoder.beginRenderPass({
      label: 'env-brdf-bake',
      colorAttachments: [
        { view: this.brdfLutView!, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } },
      ],
    });
    pass.setPipeline(this.brdfPipeline!);
    pass.draw(3, 1, 0, 0);
    pass.end();
    renderer.submit([encoder.finish()]);
  }
}
