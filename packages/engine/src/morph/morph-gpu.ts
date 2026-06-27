import type { Entity } from '@retro-engine/ecs';
import type { BindGroup, BindGroupLayout, Buffer, Renderer } from '@retro-engine/renderer-core';
import { BufferUsage, ShaderStage } from '@retro-engine/renderer-core';

import type { MorphTargets } from './morph-targets';
import { MORPH_DELTA_FLOATS, packMorphDeltas } from './morph-pack';

/**
 * `@group` index the morph storage buffers + params uniform bind at. Shares the
 * slot with the skinning palette and SSAO; the morphed pipeline variant owns it
 * exclusively (SSAO is disabled for morphed draws, and the skinned+morphed
 * variant — when it lands — combines palette and morph into one group(3)).
 */
export const MORPH_GROUP = 3 as const;

/** Bytes in the morph params uniform: `vertex_base`, `target_count`, `vertex_count`, pad. */
const PARAMS_BYTE_SIZE = 16;

/** A mesh's uploaded morph deltas: the storage buffer plus its dimensions. */
interface DeltaEntry {
  readonly buffer: Buffer;
  readonly vertexCount: number;
  readonly targetCount: number;
  /** Identity of the source store, so a reloaded/edited mesh re-uploads. */
  source: MorphTargets;
}

/** An entity's per-frame morph resources: weights + params + the bind group. */
interface EntityEntry {
  weightsBuffer: Buffer;
  /** Weight slots the buffer can hold; only grows. */
  weightsCapacity: number;
  paramsBuffer: Buffer;
  bindGroup: BindGroup;
  meshIndex: number;
  targetCount: number;
  /** The delta buffer the bind group references, to detect a re-upload. */
  deltaBuffer: Buffer;
}

/**
 * The GPU side of runtime morph targets: per-mesh delta storage buffers (static,
 * uploaded once per mesh), per-entity weight + params buffers (rewritten each
 * frame from the entity's `MorphWeights`), and the `@group(3)` bind group the
 * morphed pipeline variant reads.
 *
 * A render-stage resource. WebGPU-only — gated by
 * `RendererCapabilities.storageBuffers` at the call sites; on a backend without
 * it the morph path is never set up and morphing meshes draw from base geometry.
 */
export class MorphGpu {
  private layoutValue?: BindGroupLayout;
  private readonly deltas = new Map<number, DeltaEntry>();
  private readonly entities = new Map<Entity, EntityEntry>();
  private weightScratch = new Float32Array(0);
  private readonly paramsScratch = new Uint32Array(4);

  /** The morphed-variant `@group(3)` layout: deltas + weights storage, params uniform. */
  ensureLayout(renderer: Renderer): BindGroupLayout {
    if (this.layoutValue === undefined) {
      this.layoutValue = renderer.createBindGroupLayout({
        label: 'morph',
        entries: [
          { binding: 0, visibility: ShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
          { binding: 1, visibility: ShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
          { binding: 2, visibility: ShaderStage.VERTEX, buffer: { type: 'uniform' } },
        ],
      });
    }
    return this.layoutValue;
  }

  /**
   * Ensure a mesh's morph deltas are uploaded, (re)packing only when the mesh's
   * {@link MorphTargets} store is new or has been swapped. Target-major layout:
   * `delta[target · vertexCount + vertex]`, each a padded position + normal delta.
   */
  ensureDeltas(renderer: Renderer, meshIndex: number, morph: MorphTargets): DeltaEntry {
    const existing = this.deltas.get(meshIndex);
    if (existing !== undefined && existing.source === morph) return existing;
    existing?.buffer.destroy();

    const vertexCount = morph.vertexCount;
    const targetCount = morph.count;
    const packed = packMorphDeltas(morph);
    const buffer = renderer.createBuffer({
      label: `morph-deltas#${meshIndex}`,
      size: Math.max(MORPH_DELTA_FLOATS * 4, packed.byteLength),
      usage: BufferUsage.STORAGE | BufferUsage.COPY_DST,
    });
    renderer.writeBuffer(buffer, 0, packed as unknown as BufferSource);
    const entry: DeltaEntry = { buffer, vertexCount, targetCount, source: morph };
    this.deltas.set(meshIndex, entry);
    return entry;
  }

  /**
   * Write an entity's live weights and params, (re)building its bind group when
   * the referenced delta buffer, mesh, or target count changes. Returns the
   * `@group(3)` bind group to bind for this entity's morphed draw.
   */
  prepareEntity(
    renderer: Renderer,
    entity: Entity,
    delta: DeltaEntry,
    meshIndex: number,
    weights: readonly number[],
    vertexBase: number,
  ): BindGroup {
    const targetCount = delta.targetCount;
    let entry = this.entities.get(entity);

    if (entry === undefined || entry.weightsCapacity < targetCount) {
      entry?.weightsBuffer.destroy();
      const capacity = Math.max(targetCount, 1);
      const weightsBuffer = renderer.createBuffer({
        label: `morph-weights#${entity}`,
        size: capacity * 4,
        usage: BufferUsage.STORAGE | BufferUsage.COPY_DST,
      });
      if (entry === undefined) {
        const paramsBuffer = renderer.createBuffer({
          label: `morph-params#${entity}`,
          size: PARAMS_BYTE_SIZE,
          usage: BufferUsage.UNIFORM | BufferUsage.COPY_DST,
        });
        entry = {
          weightsBuffer,
          weightsCapacity: capacity,
          paramsBuffer,
          bindGroup: undefined as unknown as BindGroup,
          meshIndex: -1,
          targetCount: -1,
          deltaBuffer: undefined as unknown as Buffer,
        };
        this.entities.set(entity, entry);
      } else {
        entry.weightsBuffer = weightsBuffer;
        entry.weightsCapacity = capacity;
      }
    }

    if (
      entry.deltaBuffer !== delta.buffer ||
      entry.meshIndex !== meshIndex ||
      entry.targetCount !== targetCount ||
      entry.bindGroup === undefined
    ) {
      entry.bindGroup = renderer.createBindGroup({
        label: `morph#${entity}`,
        layout: this.ensureLayout(renderer),
        entries: [
          { binding: 0, resource: { buffer: delta.buffer } },
          { binding: 1, resource: { buffer: entry.weightsBuffer } },
          { binding: 2, resource: { buffer: entry.paramsBuffer } },
        ],
      });
      entry.deltaBuffer = delta.buffer;
      entry.meshIndex = meshIndex;
      entry.targetCount = targetCount;
    }

    if (this.weightScratch.length < targetCount) this.weightScratch = new Float32Array(targetCount);
    for (let i = 0; i < targetCount; i++) this.weightScratch[i] = weights[i] ?? 0;
    renderer.writeBuffer(
      entry.weightsBuffer,
      0,
      this.weightScratch.subarray(0, targetCount) as unknown as BufferSource,
    );

    this.paramsScratch[0] = vertexBase;
    this.paramsScratch[1] = targetCount;
    this.paramsScratch[2] = delta.vertexCount;
    this.paramsScratch[3] = 0;
    renderer.writeBuffer(entry.paramsBuffer, 0, this.paramsScratch as unknown as BufferSource);

    return entry.bindGroup;
  }

  /** Drop and free per-entity resources for entities not in `live` this frame. */
  retainEntities(live: ReadonlySet<Entity>): void {
    for (const [entity, entry] of this.entities) {
      if (live.has(entity)) continue;
      entry.weightsBuffer.destroy();
      entry.paramsBuffer.destroy();
      this.entities.delete(entity);
    }
  }
}
