import type {
  PipelineLayout,
  RenderPipeline,
  RenderPipelineDescriptor,
  ShaderModule,
  TextureFormat,
} from '@retro-engine/renderer-core';

import { ViewBindGroupCache } from '../camera/extracted';
import type { App } from '../index';
import { PipelineCache } from '../shader/pipeline-cache';
import { Shader } from '../shader/shader';
import { ShaderRegistry } from '../shader/shader-registry';
import { SpecializedRenderPipelines } from '../shader/specialized-render-pipeline';

import { GizmoBufferGpu } from './gizmo-buffer-gpu';
import { GIZMO_VERTEX_FLOATS } from './gizmo-layers';
import type { Gizmos } from './gizmos';

/** Specialization key: one pipeline per target color format, depth format, and depth-test mode. */
export interface GizmoPipelineKey {
  readonly colorFormat: TextureFormat;
  /** Depth attachment format, or `null` for a depth-less (2D) pass. */
  readonly depthFormat: TextureFormat | null;
  /** `true` = occluded by depth (`less-equal`); `false` = always-on-top (`always`). */
  readonly depthTest: boolean;
}

/** A contiguous run of vertices in the line buffer sharing a layer mask and depth mode. */
export interface GizmoDrawRange {
  readonly layerMask: number;
  readonly depthTest: boolean;
  readonly firstVertex: number;
  readonly vertexCount: number;
}

const FLOATS_PER_VERTEX = GIZMO_VERTEX_FLOATS;
const VERTS_PER_SEGMENT = 2;

/**
 * Render-world resource owning the gizmo line pass's GPU state: the shared line
 * vertex buffer, the format-specialized pipelines, and the per-frame draw
 * ranges the pass node consumes.
 *
 * GPU resource creation is deferred to the first frame via
 * {@link ensureInitialised} — the renderer's device and the `@group(0)` view
 * layout do not exist until cameras have prepared.
 *
 * @internal
 */
export class GizmoMesh {
  readonly gpu = new GizmoBufferGpu();
  /** Draw ranges built each frame by {@link prepare}, consumed by the pass node. */
  draws: GizmoDrawRange[] = [];

  private shaderModule: ShaderModule | undefined;
  private specialized: SpecializedRenderPipelines<GizmoPipelineKey> | undefined;
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
    const viewCache = app.getResource(ViewBindGroupCache);
    if (pipelineCache === undefined) {
      throw new Error('GizmoMesh: PipelineCache missing; ShaderPlugin must run before GizmoPlugin.');
    }
    if (registry === undefined) {
      throw new Error('GizmoMesh: ShaderRegistry missing; ShaderPlugin must run before GizmoPlugin.');
    }
    const viewLayout = viewCache?.layout;
    if (viewLayout === undefined) return false; // No camera has prepared yet; try next frame.
    const source = registry.get('retro_engine::gizmo');
    if (source === undefined) {
      throw new Error("GizmoMesh: shader 'retro_engine::gizmo' not registered; GizmoPlugin must register it on build.");
    }
    this.shaderModule = pipelineCache.compileShader(new Shader(source, { label: 'retro_engine::gizmo' }));
    const pipelineLayout = app.renderer.createPipelineLayout({
      label: 'gizmo-pipeline-layout',
      bindGroupLayouts: [viewLayout],
    });
    this.specialized = new SpecializedRenderPipelines<GizmoPipelineKey>(
      pipelineCache,
      (key) => this.specialize(key, pipelineLayout),
      (key) => `gizmo|c=${key.colorFormat}|d=${key.depthFormat ?? 'none'}|t=${key.depthTest ? 1 : 0}`,
    );
    this.initialised = true;
    return true;
  }

  /** The pipeline for a target format / depth mode. Caller must have initialised first. */
  pipeline(key: GizmoPipelineKey): RenderPipeline {
    if (this.specialized === undefined) {
      throw new Error('GizmoMesh.pipeline: not initialised — call ensureInitialised first.');
    }
    return this.specialized.get(key);
  }

  /**
   * Pack this frame's segments into the GPU buffer, grouped into contiguous
   * draw ranges by `(depthTest, layerMask)`, and upload. Groups are tiny in
   * practice (one or two layers), so the bucketing cost is negligible.
   */
  prepare(app: App, gizmos: Gizmos): void {
    this.draws = [];
    const segCount = gizmos.count;
    if (segCount === 0) return;
    this.gpu.ensureCapacity(app.renderer, segCount * VERTS_PER_SEGMENT);
    const scratch = this.gpu.scratchF32;

    // Bucket segment indices by (depthTest, layerMask), preserving first-seen order.
    const buckets = new Map<string, { layerMask: number; depthTest: boolean; indices: number[] }>();
    for (let i = 0; i < segCount; i++) {
      const depthTest = gizmos.depthFlags[i] === 1;
      const layerMask = gizmos.layerMask[i]!;
      const key = `${depthTest ? 1 : 0}|${layerMask}`;
      let bucket = buckets.get(key);
      if (bucket === undefined) {
        bucket = { layerMask, depthTest, indices: [] };
        buckets.set(key, bucket);
      }
      bucket.indices.push(i);
    }

    let vertexCursor = 0;
    for (const bucket of buckets.values()) {
      const firstVertex = vertexCursor;
      for (const i of bucket.indices) {
        const p = i * 6;
        const c = i * 8;
        // Vertex A
        let o = vertexCursor * FLOATS_PER_VERTEX;
        scratch[o] = gizmos.positions[p]!;
        scratch[o + 1] = gizmos.positions[p + 1]!;
        scratch[o + 2] = gizmos.positions[p + 2]!;
        scratch[o + 3] = gizmos.colors[c]!;
        scratch[o + 4] = gizmos.colors[c + 1]!;
        scratch[o + 5] = gizmos.colors[c + 2]!;
        scratch[o + 6] = gizmos.colors[c + 3]!;
        // Vertex B
        o = (vertexCursor + 1) * FLOATS_PER_VERTEX;
        scratch[o] = gizmos.positions[p + 3]!;
        scratch[o + 1] = gizmos.positions[p + 4]!;
        scratch[o + 2] = gizmos.positions[p + 5]!;
        scratch[o + 3] = gizmos.colors[c + 4]!;
        scratch[o + 4] = gizmos.colors[c + 5]!;
        scratch[o + 5] = gizmos.colors[c + 6]!;
        scratch[o + 6] = gizmos.colors[c + 7]!;
        vertexCursor += VERTS_PER_SEGMENT;
      }
      this.draws.push({
        layerMask: bucket.layerMask,
        depthTest: bucket.depthTest,
        firstVertex,
        vertexCount: vertexCursor - firstVertex,
      });
    }
    app.renderer.writeBuffer(
      this.gpu.buffer!,
      0,
      scratch.subarray(0, vertexCursor * FLOATS_PER_VERTEX) as unknown as BufferSource,
    );
  }

  /** Drop GPU resources. Tests call this on teardown. */
  dispose(): void {
    this.gpu.dispose();
    this.draws = [];
    this.shaderModule = undefined;
    this.specialized = undefined;
    this.initialised = false;
  }

  private specialize(key: GizmoPipelineKey, pipelineLayout: PipelineLayout): RenderPipelineDescriptor {
    const descriptor: RenderPipelineDescriptor = {
      label: `gizmo|c=${key.colorFormat}|d=${key.depthFormat ?? 'none'}|t=${key.depthTest ? 1 : 0}`,
      layout: pipelineLayout,
      vertex: {
        module: this.shaderModule!,
        entryPoint: 'vs_main',
        buffers: [
          {
            arrayStride: FLOATS_PER_VERTEX * 4,
            stepMode: 'vertex',
            attributes: [
              { shaderLocation: 0, format: 'float32x3', offset: 0 },
              { shaderLocation: 1, format: 'float32x4', offset: 12 },
            ],
          },
        ],
      },
      fragment: {
        module: this.shaderModule!,
        entryPoint: 'fs_main',
        targets: [
          {
            format: key.colorFormat,
            blend: {
              color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            },
          },
        ],
      },
      primitive: { topology: 'line-list', cullMode: 'none', frontFace: 'ccw' },
    };
    if (key.depthFormat !== null) {
      descriptor.depthStencil = {
        format: key.depthFormat,
        depthWriteEnabled: false,
        depthCompare: key.depthTest ? 'less-equal' : 'always',
      };
    }
    return descriptor;
  }
}
