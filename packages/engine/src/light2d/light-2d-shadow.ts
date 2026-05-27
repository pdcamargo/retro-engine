import type {
  BindGroup,
  BindGroupLayout,
  Buffer,
  PipelineLayout,
  RenderPipeline,
  Sampler,
  ShaderModule,
  Texture,
  TextureFormat,
  TextureView,
} from '@retro-engine/renderer-core';
import { BufferUsage, ShaderStage, TextureUsage } from '@retro-engine/renderer-core';

import type { App } from '../index';
import { PipelineCache } from '../shader/pipeline-cache';
import { Shader } from '../shader/shader';
import { ShaderRegistry } from '../shader/shader-registry';
import type { GlobalTransform } from '../transform';

import type { Light2dPipeline } from './light-2d-pipeline';
import type { LightOccluder2d } from './light-occluder-2d';

/** Angular resolution of each light's 1D shadow map (texels per full turn). */
export const LIGHT2D_SHADOW_ATLAS_WIDTH = 256 as const;

/** Atlas height — the maximum number of shadow-casting lights resolved per frame (one row each). */
export const LIGHT2D_MAX_SHADOW_CASTERS = 64 as const;

/** Maximum occluder segments considered per frame; extras are ignored. */
export const LIGHT2D_MAX_OCCLUDER_SEGMENTS = 256 as const;

/**
 * Float format of the shadow atlas — the normalized nearest-occluder distance
 * per angle is stored in the red channel. `rgba16float` (rather than a
 * single-channel format) keeps the HAL format list small; the atlas is tiny
 * (`LIGHT2D_SHADOW_ATLAS_WIDTH × LIGHT2D_MAX_SHADOW_CASTERS`), so the unused
 * channels cost little.
 */
export const LIGHT2D_SHADOW_ATLAS_FORMAT: TextureFormat = 'rgba16float';

const SEGMENTS_OFFSET = 4; // after the counts vec4
const SEGMENT_FLOATS = 4;
const LIGHTS_OFFSET = SEGMENTS_OFFSET + LIGHT2D_MAX_OCCLUDER_SEGMENTS * SEGMENT_FLOATS;
const LIGHT_FLOATS = 4;
const UNIFORM_FLOATS = LIGHTS_OFFSET + LIGHT2D_MAX_SHADOW_CASTERS * LIGHT_FLOATS;

/**
 * Transform a 2D point by the upper 2×2 + translation of a `GlobalTransform`
 * matrix (column-major `Mat4`). Z is ignored.
 *
 * @internal
 */
const transformPoint = (m: Float32Array, x: number, y: number): [number, number] => [
  (m[0] as number) * x + (m[4] as number) * y + (m[12] as number),
  (m[1] as number) * x + (m[5] as number) * y + (m[13] as number),
];

/**
 * Render-world resource owning the 2D shadow atlas and its analytic build
 * pipeline.
 *
 * The atlas is one shared `LIGHT2D_SHADOW_ATLAS_WIDTH × LIGHT2D_MAX_SHADOW_CASTERS`
 * single-channel float texture — one row per shadow-casting light, each row a
 * 1D map of normalized nearest-occluder distance per angle. It is camera-
 * independent (occluders and lights live in world space), so it is built once
 * per frame and sampled by every camera's accumulation pass.
 *
 * The build inputs (occluder segments + per-row light center/range + counts)
 * live in a single uniform buffer, packed each frame by the lighting queue and
 * uploaded via {@link upload}.
 *
 * @internal
 */
export class Light2dShadowState {
  atlasTexture: Texture | undefined;
  atlasView: TextureView | undefined;
  sampler: Sampler | undefined;

  uniformBuffer: Buffer | undefined;
  readonly scratch: Float32Array = new Float32Array(UNIFORM_FLOATS);

  buildBindGroupLayout: BindGroupLayout | undefined;
  buildPipelineLayout: PipelineLayout | undefined;
  buildModule: ShaderModule | undefined;
  buildPipeline: RenderPipeline | undefined;
  buildBindGroup: BindGroup | undefined;

  /** `@group(1)` bind group the accumulation pass binds to sample the atlas. */
  accumBindGroup: BindGroup | undefined;

  occluderCount = 0;
  casterCount = 0;
  /** Reset to `false` each frame by the prepare system; set `true` once the atlas is built. */
  builtThisFrame = false;

  private initialised = false;

  /**
   * Lazy GPU-resource bootstrap. Idempotent. Returns `false` (changing nothing)
   * until the accumulation pipeline's shadow bind-group layout exists — the
   * accumulation bind group can't be built before then.
   */
  ensure(app: App, pipeline: Light2dPipeline): boolean {
    if (this.initialised) return true;
    const shadowLayout = pipeline.shadowAccumBindGroupLayout;
    if (shadowLayout === undefined) return false;

    const renderer = app.renderer;
    const pipelineCache = app.getResource(PipelineCache);
    const registry = app.getResource(ShaderRegistry);
    if (pipelineCache === undefined || registry === undefined) {
      throw new Error(
        'Light2dShadowState: PipelineCache / ShaderRegistry missing; ShaderPlugin must run before Light2dPlugin.',
      );
    }

    this.atlasTexture = renderer.createTexture({
      label: 'light2d-shadow-atlas',
      width: LIGHT2D_SHADOW_ATLAS_WIDTH,
      height: LIGHT2D_MAX_SHADOW_CASTERS,
      format: LIGHT2D_SHADOW_ATLAS_FORMAT,
      usage: TextureUsage.RENDER_ATTACHMENT | TextureUsage.TEXTURE_BINDING,
    });
    this.atlasView = this.atlasTexture.createView();
    this.sampler = renderer.createSampler({
      label: 'light2d-shadow-sampler',
      magFilter: 'linear',
      minFilter: 'linear',
      // Angle wraps at the ±π seam; clamp rows.
      addressModeU: 'repeat',
      addressModeV: 'clamp-to-edge',
    });
    this.uniformBuffer = renderer.createBuffer({
      label: 'light2d-shadow-uniform',
      size: UNIFORM_FLOATS * 4,
      usage: BufferUsage.UNIFORM | BufferUsage.COPY_DST,
    });

    this.buildBindGroupLayout = renderer.createBindGroupLayout({
      label: 'light2d-shadow-build-layout',
      entries: [{ binding: 0, visibility: ShaderStage.FRAGMENT, buffer: { type: 'uniform' } }],
    });
    this.buildPipelineLayout = renderer.createPipelineLayout({
      label: 'light2d-shadow-build-pipeline-layout',
      bindGroupLayouts: [this.buildBindGroupLayout],
    });
    const source = registry.get('retro_engine::light2d_shadow');
    if (source === undefined) {
      throw new Error(
        "Light2dShadowState: shader module 'retro_engine::light2d_shadow' not registered; Light2dPlugin must register it on build.",
      );
    }
    this.buildModule = (pipelineCache as PipelineCache).compileShader(
      new Shader(source, { label: 'retro_engine::light2d_shadow' }),
    );
    this.buildPipeline = (pipelineCache as PipelineCache).getOrCreateRenderPipeline({
      label: 'light2d-shadow-build',
      layout: this.buildPipelineLayout,
      vertex: { module: this.buildModule, entryPoint: 'vs_main', buffers: [] },
      fragment: {
        module: this.buildModule,
        entryPoint: 'fs_main',
        targets: [{ format: LIGHT2D_SHADOW_ATLAS_FORMAT }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none', frontFace: 'ccw' },
    });
    this.buildBindGroup = renderer.createBindGroup({
      label: 'light2d-shadow-build-bind-group',
      layout: this.buildBindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });
    this.accumBindGroup = pipeline.buildShadowAccumBindGroup(app, this.atlasView, this.sampler);

    this.initialised = true;
    return true;
  }

  /** Reset the per-frame occluder / caster counts ahead of repacking. */
  beginFrame(): void {
    this.builtThisFrame = false;
    this.occluderCount = 0;
    this.casterCount = 0;
  }

  /**
   * Pack a light's center + range into its atlas row. Returns the row index, or
   * `-1` when the caster budget ({@link LIGHT2D_MAX_SHADOW_CASTERS}) is full.
   */
  pushCaster(centerX: number, centerY: number, range: number): number {
    if (this.casterCount >= LIGHT2D_MAX_SHADOW_CASTERS) return -1;
    const row = this.casterCount;
    const off = LIGHTS_OFFSET + row * LIGHT_FLOATS;
    this.scratch[off + 0] = centerX;
    this.scratch[off + 1] = centerY;
    this.scratch[off + 2] = range;
    this.scratch[off + 3] = 0;
    this.casterCount = row + 1;
    return row;
  }

  /** Pack one occluder's world-space segments. Extras past the budget are dropped. */
  pushOccluder(occluder: LightOccluder2d, gt: GlobalTransform): void {
    const m = gt.matrix as unknown as Float32Array;
    for (const seg of occluder.segments) {
      if (this.occluderCount >= LIGHT2D_MAX_OCCLUDER_SEGMENTS) return;
      const a = seg[0];
      const b = seg[1];
      const [ax, ay] = transformPoint(m, a[0] as number, a[1] as number);
      const [bx, by] = transformPoint(m, b[0] as number, b[1] as number);
      const off = SEGMENTS_OFFSET + this.occluderCount * SEGMENT_FLOATS;
      this.scratch[off + 0] = ax;
      this.scratch[off + 1] = ay;
      this.scratch[off + 2] = bx;
      this.scratch[off + 3] = by;
      this.occluderCount += 1;
    }
  }

  /** Write the counts header and upload the build uniform to the GPU. */
  upload(app: App): void {
    this.scratch[0] = this.occluderCount;
    this.scratch[1] = this.casterCount;
    if (this.uniformBuffer !== undefined) {
      app.renderer.writeBuffer(this.uniformBuffer, 0, this.scratch as unknown as BufferSource);
    }
  }

  /** Drop every GPU resource. Tests call this on teardown. */
  dispose(): void {
    this.atlasView?.destroy();
    this.atlasTexture?.destroy();
    this.sampler?.destroy();
    this.uniformBuffer?.destroy();
    this.buildBindGroupLayout?.destroy();
    this.buildPipelineLayout?.destroy();
    this.atlasTexture = undefined;
    this.atlasView = undefined;
    this.sampler = undefined;
    this.uniformBuffer = undefined;
    this.buildBindGroupLayout = undefined;
    this.buildPipelineLayout = undefined;
    this.buildModule = undefined;
    this.buildPipeline = undefined;
    this.buildBindGroup = undefined;
    this.accumBindGroup = undefined;
    this.occluderCount = 0;
    this.casterCount = 0;
    this.initialised = false;
  }
}
