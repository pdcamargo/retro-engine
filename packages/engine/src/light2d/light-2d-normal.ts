import type { Query as QueryHandle } from '@retro-engine/ecs';
import type {
  Buffer,
  RenderPipeline,
  Sampler,
  TextureFormat,
} from '@retro-engine/renderer-core';
import { BufferUsage } from '@retro-engine/renderer-core';
import type { Handle } from '@retro-engine/assets';

import { Images } from '../image/images';
import type { Image } from '../image/image';
import type { App } from '../index';
import { PipelineCache } from '../shader/pipeline-cache';
import {
  packSpriteInstance,
  SPRITE_INSTANCE_BYTE_SIZE,
  SPRITE_INSTANCE_FLOAT_COUNT,
  Sprite,
  type SpritePipeline,
} from '../sprite';
import { instanceCountForSprite } from '../sprite/sprite-batch-prepare';
import type { GlobalTransform } from '../transform';
import type { ViewVisibility } from '../visibility/visibility';

/** Format of the per-camera normal G-buffer. Tangent-space normals re-encoded to `[0, 1]`. */
export const LIGHT2D_NORMAL_FORMAT: TextureFormat = 'rgba8unorm';

/** Default world-space height of 2D lights above the sprite plane, for the `N·L` term. */
export const LIGHT2D_DEFAULT_LIGHT_HEIGHT = 64 as const;

const MIN_CAPACITY = 32 as const;
const GROWTH_FACTOR = 1.5 as const;

/** One normal-mapped sprite draw: a slice of the normal instance buffer + its normal map. */
interface NormalDraw {
  readonly firstInstance: number;
  readonly count: number;
  readonly normalMap: Handle<Image>;
}

/**
 * Render-world resource owning the 2D normal-capture path.
 *
 * Normal-map-aware lighting needs a per-pixel surface normal. Rather than make
 * the geometry passes write a second MRT target (which would force every
 * Core2d pipeline — including custom `Material2d` shaders — to output a normal),
 * normal-mapped sprites are re-drawn into a dedicated per-camera normal buffer
 * by a prepass. This resource owns the prepass pipeline (which reuses the
 * sprite vertex shader + `fs_normal` + the sprite image bind-group layout via
 * {@link SpritePipeline}), the packed normal instance buffer, the per-draw
 * list, and the `{ enabled, height }` uniform the accumulation pass reads.
 *
 * The normal buffer itself is per-camera and lives on the `ViewLight2dTargets`
 * entry; this resource only holds the camera-independent instance data, which
 * the prepass node renders through each camera's view.
 *
 * @internal
 */
export class Light2dNormalState {
  pipeline: RenderPipeline | undefined;
  sampler: Sampler | undefined;
  /** Uniform consumed by the accumulation pass: `(enabled, height, _, _)`. */
  uniformBuffer: Buffer | undefined;
  private readonly uniformScratch = new Float32Array(4);

  instanceBuffer: Buffer | undefined;
  private capacity = 0;
  private pendingDestroy: Buffer | undefined;
  private scratch = new ArrayBuffer(0);
  private scratchF32 = new Float32Array(0);
  private scratchU32 = new Uint32Array(0);

  readonly draws: NormalDraw[] = [];
  /** Total instances packed this frame (sliced sprites contribute 9 each). */
  count = 0;
  /** Whether normal mapping is enabled this frame (mirrors `Light2dSettings.normalMapping`). */
  enabled = false;

  private resourcesReady = false;
  private pipelineReady = false;

  /**
   * Create the sampler + `(enabled, height)` uniform the accumulation pass
   * needs. Sprite-independent, so the accumulation `@group(2)` works even when
   * no `SpritePlugin` is installed (the normal buffer simply stays flat).
   * Idempotent.
   */
  ensureResources(app: App): void {
    if (this.resourcesReady) return;
    const renderer = app.renderer;
    this.sampler = renderer.createSampler({
      label: 'light2d-normal-sampler',
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });
    this.uniformBuffer = renderer.createBuffer({
      label: 'light2d-normal-uniform',
      size: 16,
      usage: BufferUsage.UNIFORM | BufferUsage.COPY_DST,
    });
    this.resourcesReady = true;
  }

  /**
   * Build the normal-capture pipeline. Returns `false` until the sprite
   * pipeline is initialised — the normal pipeline reuses its compiled module,
   * layout, and quad buffers. Only the prepass needs this; without it the
   * normal buffer stays flat (no normal-mapped sprites are captured).
   */
  ensurePipeline(app: App, sprite: SpritePipeline): boolean {
    if (this.pipelineReady) return true;
    if (
      sprite.vertexModule === undefined ||
      sprite.pipelineLayout === undefined ||
      sprite.quadVertexBuffer === undefined
    ) {
      return false;
    }
    const pipelineCache = app.getResource(PipelineCache);
    if (pipelineCache === undefined) {
      throw new Error(
        'Light2dNormalState: PipelineCache resource missing; ShaderPlugin must run before Light2dPlugin.',
      );
    }
    this.pipeline = (pipelineCache as PipelineCache).getOrCreateRenderPipeline({
      label: 'light2d-normal',
      layout: sprite.pipelineLayout,
      vertex: {
        module: sprite.vertexModule,
        entryPoint: 'vs_main',
        buffers: [
          { arrayStride: 8, stepMode: 'vertex', attributes: [{ shaderLocation: 0, format: 'float32x2', offset: 0 }] },
          {
            arrayStride: SPRITE_INSTANCE_BYTE_SIZE,
            stepMode: 'instance',
            attributes: [
              { shaderLocation: 2, format: 'float32x4', offset: 0 },
              { shaderLocation: 3, format: 'float32x4', offset: 16 },
              { shaderLocation: 4, format: 'float32x2', offset: 32 },
              { shaderLocation: 5, format: 'unorm8x4', offset: 40 },
            ],
          },
        ],
      },
      fragment: {
        module: sprite.vertexModule,
        entryPoint: 'fs_normal',
        targets: [{ format: LIGHT2D_NORMAL_FORMAT }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none', frontFace: 'ccw' },
    });
    this.pipelineReady = true;
    return true;
  }

  private ensureCapacity(app: App, requiredInstances: number): void {
    if (this.pendingDestroy !== undefined) {
      this.pendingDestroy.destroy();
      this.pendingDestroy = undefined;
    }
    if (requiredInstances <= this.capacity && this.instanceBuffer !== undefined) return;
    let next = this.capacity > 0 ? this.capacity : MIN_CAPACITY;
    while (next < requiredInstances) next = Math.max(next + 1, Math.ceil(next * GROWTH_FACTOR));
    const fresh = app.renderer.createBuffer({
      label: 'light2d-normal-instance-buffer',
      size: next * SPRITE_INSTANCE_BYTE_SIZE,
      usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
    });
    if (this.instanceBuffer !== undefined) this.pendingDestroy = this.instanceBuffer;
    this.instanceBuffer = fresh;
    this.capacity = next;
    const floats = next * SPRITE_INSTANCE_FLOAT_COUNT;
    if (this.scratchF32.length < floats) {
      this.scratch = new ArrayBuffer(floats * 4);
      this.scratchF32 = new Float32Array(this.scratch);
      this.scratchU32 = new Uint32Array(this.scratch);
    }
  }

  /** Push the `(enabled, height)` uniform for the accumulation pass to read. */
  writeUniform(app: App, enabled: boolean, height: number): void {
    this.enabled = enabled;
    this.uniformScratch[0] = enabled ? 1 : 0;
    this.uniformScratch[1] = height;
    if (this.uniformBuffer !== undefined) {
      app.renderer.writeBuffer(this.uniformBuffer, 0, this.uniformScratch as unknown as BufferSource);
    }
  }

  /**
   * Pack the visible normal-mapped sprites into the normal instance buffer and
   * record one draw per sprite (bound to its normal map). No-op when normal
   * mapping is disabled.
   */
  capture(
    app: App,
    sprites: QueryHandle<readonly [typeof Sprite, typeof GlobalTransform, typeof ViewVisibility]>,
    images: Images,
  ): void {
    this.draws.length = 0;
    this.count = 0;
    if (!this.enabled) return;

    const visible: { sprite: Sprite; gt: GlobalTransform; instances: number }[] = [];
    let totalInstances = 0;
    for (const row of sprites.entries()) {
      const sprite = row[1] as Sprite;
      const vis = row[3] as ViewVisibility;
      if (!vis.visible || sprite.normalMap === undefined) continue;
      const instances = instanceCountForSprite(sprite);
      visible.push({ sprite, gt: row[2] as GlobalTransform, instances });
      totalInstances += instances;
    }
    if (totalInstances === 0) return;

    this.ensureCapacity(app, totalInstances);
    let cursorFloats = 0;
    let cursorInstances = 0;
    for (const { sprite, gt, instances } of visible) {
      const img = images.get(sprite.image ?? images.WHITE);
      const imageSize = img !== undefined ? { width: img.width, height: img.height } : { width: 1, height: 1 };
      const consumed = packSpriteInstance(sprite, gt.matrix, imageSize, this.scratchF32, this.scratchU32, cursorFloats);
      this.draws.push({ firstInstance: cursorInstances, count: instances, normalMap: sprite.normalMap! });
      cursorFloats += consumed;
      cursorInstances += instances;
    }
    this.count = cursorInstances;
    if (this.instanceBuffer !== undefined && cursorFloats > 0) {
      const view = this.scratchF32.subarray(0, cursorFloats);
      app.renderer.writeBuffer(this.instanceBuffer, 0, view as unknown as BufferSource);
    }
  }

  dispose(): void {
    this.pipeline = undefined;
    this.sampler?.destroy();
    this.uniformBuffer?.destroy();
    this.instanceBuffer?.destroy();
    this.pendingDestroy?.destroy();
    this.sampler = undefined;
    this.uniformBuffer = undefined;
    this.instanceBuffer = undefined;
    this.pendingDestroy = undefined;
    this.capacity = 0;
    this.count = 0;
    this.draws.length = 0;
    this.resourcesReady = false;
    this.pipelineReady = false;
  }
}
