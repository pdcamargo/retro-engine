import type {
  BindGroup,
  BindGroupLayout,
  Buffer,
  PipelineLayout,
  PrimitiveTopology,
  RenderPipeline,
  RenderPipelineDescriptor,
  Sampler,
  ShaderModule,
  Texture,
  TextureFormat,
  TextureView,
  VertexBufferLayout,
} from '@retro-engine/renderer-core';
import { BufferUsage, ShaderStage, TextureUsage } from '@retro-engine/renderer-core';

import type { App } from '../index';
import { INSTANCE_LAYOUT } from '../material/instance-layout';
import { MeshInstanceBuffer } from '../material/mesh-instance-buffer';
import type { AllocatorSlice, RenderMesh } from '../mesh';
import { PipelineCache } from '../shader/pipeline-cache';
import { Shader } from '../shader/shader';

import type { GpuLights } from './gpu-lights';
import { MAX_SHADOW_CASTERS } from './gpu-lights';
import type { Shadow3dSettings } from './shadow-3d-settings';
import { SHADOW3D_DEPTH_WGSL } from './shadow-3d.wgsl';

/** Per-layer resolution (texels) of the square shadow-atlas array. Tunable. */
export const SHADOW_MAP_SIZE = 1024 as const;

/** Depth format of the shadow atlas. `depth32float` for precision + wide support. */
export const SHADOW_ATLAS_FORMAT: TextureFormat = 'depth32float';

const VIEW_PROJ_BYTES = 64; // one mat4x4<f32>

/**
 * One instanced shadow-caster draw: a mesh batch re-rendered (depth only) into
 * every shadow-casting light's atlas layer. Pipeline is specialized per mesh
 * vertex layout; the instance slice is shared across all layers (a caster casts
 * into every light's map).
 *
 * @internal
 */
export interface ShadowCasterBatch {
  readonly pipeline: RenderPipeline;
  readonly vertexSlice: AllocatorSlice;
  readonly indexSlice: AllocatorSlice | undefined;
  readonly renderMesh: RenderMesh;
  readonly firstInstance: number;
  readonly count: number;
}

/**
 * Render-world resource owning the 3D shadow-map atlas and its depth-render
 * pipeline.
 *
 * The atlas is one `depth32float` 2D-array texture, `SHADOW_MAP_SIZE` square,
 * with one layer per shadow-casting light ({@link MAX_SHADOW_CASTERS} budget).
 * Each frame `shadow3d-prepare` ensures the GPU resources exist, `light3d-prepare`
 * assigns caster layers + computes per-light light-space matrices (uploaded into
 * the per-layer view-proj uniforms), and `shadow3d-queue` packs caster mesh
 * instances. The `Shadow3dPass3dNode` then renders each light's depth into its
 * layer; `pbr.wgsl` samples the atlas (bound via the `GpuLights` `@group(2)`
 * bind group) with a comparison sampler.
 *
 * @internal
 */
export class Shadow3dState {
  /** 2D-array depth atlas; one layer per shadow caster. */
  atlasTexture: Texture | undefined;
  /** Full-array view (`2d-array`) bound for sampling at `@group(2) @binding(1)`. */
  atlasArrayView: TextureView | undefined;
  /** Per-layer single-slice (`2d`) views used as the depth render target. */
  readonly layerViews: TextureView[] = [];
  /** Comparison sampler bound at `@group(2) @binding(2)`. */
  comparisonSampler: Sampler | undefined;

  /** `@group(0)` layout for the depth pass: one vertex-visible view-proj uniform. */
  shadowViewLayout: BindGroupLayout | undefined;
  shadowPipelineLayout: PipelineLayout | undefined;
  depthModule: ShaderModule | undefined;

  /** Per-layer light-space view-proj uniform buffer + its `@group(0)` bind group. */
  readonly viewProjBuffers: Buffer[] = [];
  readonly layerBindGroups: BindGroup[] = [];
  /**
   * CPU-staged light-space matrices for the assigned layers. `light3d-prepare`
   * writes them (it owns the light transforms); `shadow3d-prepare` flushes them
   * to {@link viewProjBuffers} after {@link ensure} — so the depth-pass uniforms
   * are populated the same frame the buffers come into existence.
   */
  readonly pendingViewProj = new Float32Array(MAX_SHADOW_CASTERS * 16);

  /** Depth pipelines keyed by mesh vertex-layout identity (PipelineCache dedupes too). */
  private readonly pipelines = new Map<VertexBufferLayout, RenderPipeline>();

  /** Caster mesh instances for this frame; one entry per (mesh) batch. */
  readonly casterBatches: ShadowCasterBatch[] = [];
  /** Shared caster transform buffer (model matrix per instance). */
  readonly instanceBuffer = new MeshInstanceBuffer();
  /** Number of shadow-casting lights assigned a layer this frame (= layers to render). */
  shadowLightCount = 0;
  /** Reset to `false` each frame; set `true` once the atlas is rendered. */
  builtThisFrame = false;

  private initialised = false;

  /**
   * Lazy GPU bootstrap. Idempotent. Returns `false` (changing nothing) until
   * the `GpuLights` `@group(2)` layout exists — the shadow atlas + comparison
   * sampler are bound through that bind group, which is built here.
   */
  ensure(app: App, gpuLights: GpuLights): boolean {
    if (this.initialised) return true;
    if (gpuLights.layout === undefined) return false;

    const renderer = app.renderer;
    const pipelineCache = app.getResource(PipelineCache);
    if (pipelineCache === undefined) {
      throw new Error(
        'Shadow3dState: PipelineCache missing; ShaderPlugin must run before Light3dPlugin.',
      );
    }

    this.atlasTexture = renderer.createTexture({
      label: 'shadow3d-atlas',
      width: SHADOW_MAP_SIZE,
      height: SHADOW_MAP_SIZE,
      depthOrArrayLayers: MAX_SHADOW_CASTERS,
      format: SHADOW_ATLAS_FORMAT,
      usage: TextureUsage.RENDER_ATTACHMENT | TextureUsage.TEXTURE_BINDING,
    });
    this.atlasArrayView = this.atlasTexture.createView({
      label: 'shadow3d-atlas-array',
      dimension: '2d-array',
      aspect: 'depth-only',
    });
    this.comparisonSampler = renderer.createSampler({
      label: 'shadow3d-sampler',
      compare: 'less-equal',
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });

    this.shadowViewLayout = renderer.createBindGroupLayout({
      label: 'shadow3d-view-layout',
      entries: [{ binding: 0, visibility: ShaderStage.VERTEX, buffer: { type: 'uniform' } }],
    });
    this.shadowPipelineLayout = renderer.createPipelineLayout({
      label: 'shadow3d-pipeline-layout',
      bindGroupLayouts: [this.shadowViewLayout],
    });
    this.depthModule = (pipelineCache as PipelineCache).compileShader(
      new Shader(SHADOW3D_DEPTH_WGSL, { label: 'retro_engine::shadow3d_depth' }),
    );

    for (let i = 0; i < MAX_SHADOW_CASTERS; i++) {
      const buffer = renderer.createBuffer({
        label: `shadow3d-view-proj#${i}`,
        size: VIEW_PROJ_BYTES,
        usage: BufferUsage.UNIFORM | BufferUsage.COPY_DST,
      });
      this.viewProjBuffers.push(buffer);
      this.layerBindGroups.push(
        renderer.createBindGroup({
          label: `shadow3d-view#${i}`,
          layout: this.shadowViewLayout,
          entries: [{ binding: 0, resource: { buffer } }],
        }),
      );
      this.layerViews.push(
        this.atlasTexture.createView({
          label: `shadow3d-atlas-layer#${i}`,
          dimension: '2d',
          baseArrayLayer: i,
          arrayLayerCount: 1,
          aspect: 'depth-only',
        }),
      );
    }

    // Bind the atlas + comparison sampler into the lights @group(2) bind group.
    gpuLights.buildShadowBindGroup(renderer, this.atlasArrayView, this.comparisonSampler);

    this.initialised = true;
    return true;
  }

  /** Reset per-frame caster + layer state ahead of repacking. */
  beginFrame(): void {
    this.builtThisFrame = false;
    this.shadowLightCount = 0;
    this.casterBatches.length = 0;
    this.instanceBuffer.count = 0;
  }

  /** Stage one light's light-space view-projection for layer `layer` (CPU only). */
  stageViewProj(layer: number, viewProj: Float32Array): void {
    this.pendingViewProj.set(viewProj, layer * 16);
  }

  /** Upload the staged matrices for the assigned layers into their uniforms. */
  flushViewProj(app: App): void {
    for (let layer = 0; layer < this.shadowLightCount; layer++) {
      const buffer = this.viewProjBuffers[layer];
      if (buffer === undefined) continue;
      app.renderer.writeBuffer(
        buffer,
        0,
        this.pendingViewProj.subarray(layer * 16, layer * 16 + 16) as unknown as BufferSource,
      );
    }
  }

  /**
   * Get (or build) the depth-only pipeline for a mesh vertex layout + topology.
   * Vertex buffers are `[meshLayout, INSTANCE_LAYOUT]`; the depth shader reads
   * position `@location(0)` and the model matrix `@location(8..11)`.
   */
  pipelineFor(
    pipelineCache: PipelineCache,
    meshLayout: VertexBufferLayout,
    topology: PrimitiveTopology,
    settings: Shadow3dSettings,
  ): RenderPipeline {
    const cached = this.pipelines.get(meshLayout);
    if (cached !== undefined) return cached;
    const descriptor: RenderPipelineDescriptor = {
      label: 'shadow3d-depth',
      layout: this.shadowPipelineLayout!,
      vertex: { module: this.depthModule!, entryPoint: 'vs_main', buffers: [meshLayout, INSTANCE_LAYOUT] },
      primitive: { topology, cullMode: settings.cullMode, frontFace: 'ccw' },
      depthStencil: {
        format: SHADOW_ATLAS_FORMAT,
        depthWriteEnabled: true,
        depthCompare: 'less',
        depthBias: settings.depthBias,
        depthBiasSlopeScale: settings.slopeScaleBias,
      },
    };
    const pipeline = pipelineCache.getOrCreateRenderPipeline(descriptor);
    this.pipelines.set(meshLayout, pipeline);
    return pipeline;
  }

  /** Drop every GPU resource. Tests call this on teardown. */
  dispose(): void {
    this.atlasArrayView?.destroy();
    for (const v of this.layerViews) v.destroy();
    this.atlasTexture?.destroy();
    this.comparisonSampler?.destroy();
    this.shadowViewLayout?.destroy();
    this.shadowPipelineLayout?.destroy();
    for (const b of this.viewProjBuffers) b.destroy();
    this.instanceBuffer.dispose();
    this.layerViews.length = 0;
    this.viewProjBuffers.length = 0;
    this.layerBindGroups.length = 0;
    this.pipelines.clear();
    this.casterBatches.length = 0;
    this.atlasTexture = undefined;
    this.atlasArrayView = undefined;
    this.comparisonSampler = undefined;
    this.shadowViewLayout = undefined;
    this.shadowPipelineLayout = undefined;
    this.depthModule = undefined;
    this.shadowLightCount = 0;
    this.builtThisFrame = false;
    this.initialised = false;
  }
}
