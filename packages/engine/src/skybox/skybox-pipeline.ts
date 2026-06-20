import type { Entity } from '@retro-engine/ecs';
import type { Mat4 } from '@retro-engine/math';
import {
  type BindGroup,
  type BindGroupLayout,
  type Buffer,
  BufferUsage,
  type PipelineLayout,
  type RenderPipeline,
  type RenderPipelineDescriptor,
  type Sampler,
  type ShaderModule,
  ShaderStage,
  type TextureFormat,
  type TextureView,
} from '@retro-engine/renderer-core';

import { ViewBindGroupCache } from '../camera/extracted';
import type { App } from '../index';
import { PipelineCache } from '../shader/pipeline-cache';
import { Shader } from '../shader/shader';
import { ShaderRegistry } from '../shader/shader-registry';
import { SpecializedRenderPipelines } from '../shader/specialized-render-pipeline';

/** Specialization key: one pipeline per target color format and depth format. */
export interface SkyboxPipelineKey {
  readonly colorFormat: TextureFormat;
  /** Depth attachment format, or `null` for a depth-less pass. */
  readonly depthFormat: TextureFormat | null;
}

/** `f32` count of the skybox uniform: a `mat4x4` rotation + one `vec4` param block. */
const SKYBOX_UNIFORM_FLOATS = 20;
const SKYBOX_UNIFORM_BYTES = SKYBOX_UNIFORM_FLOATS * 4;

interface CameraSlot {
  readonly buffer: Buffer;
  readonly scratch: Float32Array;
  bindGroup: BindGroup | undefined;
  /** View the cached bind group was built against; rebuilds when it changes. */
  cubeView: TextureView | undefined;
}

/**
 * Render-world resource owning the skybox pass GPU state: a per-camera uniform
 * buffer (rotation + brightness), the `@group(1)` bind-group layout pairing
 * that uniform with the environment cube and its sampler, and the
 * format-specialized pipelines the pass node draws with.
 *
 * Per-camera buffers (rather than one shared buffer) keep multi-camera scenes
 * correct: each camera's rotation / brightness lands in its own buffer, so a
 * second camera with a different skybox does not clobber the first.
 *
 * GPU resource creation is deferred to the first frame via
 * {@link ensureInitialised} — the renderer device and the `@group(0)` view
 * layout do not exist until cameras have prepared.
 *
 * @internal
 */
export class SkyboxPipeline {
  /** Registered shader-module name the pipeline compiles. Defaults to the engine module. */
  shaderModuleName = 'retro_engine::skybox';

  private skyboxLayout: BindGroupLayout | undefined;
  private pipelineLayout: PipelineLayout | undefined;
  private shaderModule: ShaderModule | undefined;
  private specialized: SpecializedRenderPipelines<SkyboxPipelineKey> | undefined;
  private readonly perCamera: Map<Entity, CameraSlot> = new Map();
  private initialised = false;

  /**
   * Lazy GPU bootstrap. Idempotent. Returns `false` (changing nothing) until
   * the `@group(0)` view bind-group layout exists — it is allocated by the
   * camera plugin the first time a camera prepares.
   */
  ensureInitialised(app: App): boolean {
    if (this.initialised) return true;
    const pipelineCache = app.getResource(PipelineCache);
    const registry = app.getResource(ShaderRegistry);
    if (pipelineCache === undefined) {
      throw new Error('SkyboxPipeline: PipelineCache missing; ShaderPlugin must run before SkyboxPlugin.');
    }
    if (registry === undefined) {
      throw new Error('SkyboxPipeline: ShaderRegistry missing; ShaderPlugin must run before SkyboxPlugin.');
    }
    const viewLayout = app.getResource(ViewBindGroupCache)?.layout;
    if (viewLayout === undefined) return false; // No camera has prepared yet; try next frame.
    const source = registry.get(this.shaderModuleName);
    if (source === undefined) {
      throw new Error(
        `SkyboxPipeline: shader module '${this.shaderModuleName}' is not registered; register it before the first skybox frame.`,
      );
    }

    this.skyboxLayout = app.renderer.createBindGroupLayout({
      label: 'skybox-layout',
      entries: [
        {
          binding: 0,
          visibility: ShaderStage.FRAGMENT,
          buffer: { type: 'uniform', minBindingSize: SKYBOX_UNIFORM_BYTES },
        },
        {
          binding: 1,
          visibility: ShaderStage.FRAGMENT,
          texture: { sampleType: 'float', viewDimension: 'cube', multisampled: false },
        },
        {
          binding: 2,
          visibility: ShaderStage.FRAGMENT,
          sampler: { type: 'filtering' },
        },
      ],
    });
    this.pipelineLayout = app.renderer.createPipelineLayout({
      label: 'skybox-pipeline-layout',
      bindGroupLayouts: [viewLayout, this.skyboxLayout],
    });
    this.shaderModule = pipelineCache.compileShader(
      new Shader(source, { label: this.shaderModuleName }),
    );
    this.specialized = new SpecializedRenderPipelines<SkyboxPipelineKey>(
      pipelineCache,
      (key) => this.specialize(key),
      (key) => `skybox|c=${key.colorFormat}|d=${key.depthFormat ?? 'none'}`,
    );
    this.initialised = true;
    return true;
  }

  /** Upload a camera's rotation + brightness into its own uniform buffer. */
  writeCameraUniform(app: App, entity: Entity, rotation: Mat4, brightness: number): void {
    const slot = this.ensureSlot(app, entity);
    const s = slot.scratch;
    s.set(rotation as Float32Array, 0);
    s[16] = brightness;
    s[17] = 0;
    s[18] = 0;
    s[19] = 0;
    app.renderer.writeBuffer(slot.buffer, 0, s as unknown as BufferSource);
  }

  /**
   * Return (building on first use, re-using thereafter) a camera's `@group(1)`
   * bind group pairing its uniform buffer with the environment cube view +
   * sampler. Rebuilds when the cube view identity changes (asset reload).
   * Caller must have initialised first.
   */
  bindGroupFor(app: App, entity: Entity, cubeView: TextureView, sampler: Sampler): BindGroup {
    if (this.skyboxLayout === undefined) {
      throw new Error('SkyboxPipeline.bindGroupFor: not initialised — call ensureInitialised first.');
    }
    const slot = this.ensureSlot(app, entity);
    if (slot.bindGroup !== undefined && slot.cubeView === cubeView) return slot.bindGroup;
    if (slot.bindGroup !== undefined) slot.bindGroup.destroy();
    slot.bindGroup = app.renderer.createBindGroup({
      label: `skybox#${entity}`,
      layout: this.skyboxLayout,
      entries: [
        { binding: 0, resource: { buffer: slot.buffer } },
        { binding: 1, resource: cubeView },
        { binding: 2, resource: sampler },
      ],
    });
    slot.cubeView = cubeView;
    return slot.bindGroup;
  }

  /** The skybox pipeline for a target format / depth mode. Caller must have initialised first. */
  pipeline(key: SkyboxPipelineKey): RenderPipeline {
    if (this.specialized === undefined) {
      throw new Error('SkyboxPipeline.pipeline: not initialised — call ensureInitialised first.');
    }
    return this.specialized.get(key);
  }

  /** Forget a camera's cached buffer + bind group. Called when a camera disappears. */
  invalidate(entity: Entity): void {
    const slot = this.perCamera.get(entity);
    if (slot === undefined) return;
    slot.bindGroup?.destroy();
    slot.buffer.destroy();
    this.perCamera.delete(entity);
  }

  /** Drop every GPU resource. Tests call this on teardown. */
  dispose(): void {
    for (const slot of this.perCamera.values()) {
      slot.bindGroup?.destroy();
      slot.buffer.destroy();
    }
    this.perCamera.clear();
    this.skyboxLayout = undefined;
    this.pipelineLayout = undefined;
    this.shaderModule = undefined;
    this.specialized = undefined;
    this.initialised = false;
  }

  private ensureSlot(app: App, entity: Entity): CameraSlot {
    let slot = this.perCamera.get(entity);
    if (slot === undefined) {
      slot = {
        buffer: app.renderer.createBuffer({
          label: `skybox-uniform#${entity}`,
          size: SKYBOX_UNIFORM_BYTES,
          usage: BufferUsage.UNIFORM | BufferUsage.COPY_DST,
        }),
        scratch: new Float32Array(SKYBOX_UNIFORM_FLOATS),
        bindGroup: undefined,
        cubeView: undefined,
      };
      this.perCamera.set(entity, slot);
    }
    return slot;
  }

  private specialize(key: SkyboxPipelineKey): RenderPipelineDescriptor {
    const descriptor: RenderPipelineDescriptor = {
      label: `skybox|c=${key.colorFormat}|d=${key.depthFormat ?? 'none'}`,
      layout: this.pipelineLayout!,
      vertex: {
        module: this.shaderModule!,
        entryPoint: 'vs_main',
        buffers: [],
      },
      fragment: {
        module: this.shaderModule!,
        entryPoint: 'fs_main',
        targets: [{ format: key.colorFormat }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none', frontFace: 'ccw' },
    };
    if (key.depthFormat !== null) {
      // Depth-test against the scene so opaque geometry occludes the sky, but
      // never write depth — the sky sits at the far plane and must not block
      // the transparent pass that follows.
      descriptor.depthStencil = {
        format: key.depthFormat,
        depthWriteEnabled: false,
        depthCompare: 'less-equal',
      };
    }
    return descriptor;
  }
}
