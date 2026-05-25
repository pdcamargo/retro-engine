import type { Entity } from '@retro-engine/ecs';
import type { Mat4 } from '@retro-engine/math';
import { mat4 } from '@retro-engine/math';
import type {
  BindGroup,
  BindGroupLayout,
  Buffer,
  Renderer,
} from '@retro-engine/renderer-core';
import { BufferUsage, ShaderStage } from '@retro-engine/renderer-core';

/**
 * Layout of the `@group(1)` per-entity uniform buffer the engine binds for
 * every `Mesh3d` draw. Two `mat4x4<f32>` columns: the world-space model
 * matrix, and the inverse-transpose of the same (for transforming normals to
 * world space without scale skew).
 *
 * WGSL declaration consumers should write:
 *
 * ```wgsl
 * struct EntityTransform {
 *   model: mat4x4<f32>,
 *   inverse_transpose_model: mat4x4<f32>,
 * };
 * @group(1) @binding(0) var<uniform> entity: EntityTransform;
 * ```
 *
 * Size: 128 bytes (2 × 64). One UBO per entity per frame. The
 * inverse-transpose is computed on the CPU and uploaded; future work moves
 * this to a compute pass when entity counts justify the change.
 */
export const ENTITY_TRANSFORM_BUFFER_SIZE = 128 as const;

/**
 * Render-world cache of per-entity `@group(1)` resources: one buffer + one
 * bind group per drawable entity. Shared by every material plugin (3D + 2D);
 * the cache is keyed by entity, not by material. Reused across frames; the
 * buffer contents are re-uploaded each frame from the entity's
 * `GlobalTransform`.
 *
 * Every call to {@link ensureEntityTransform} records the entity in
 * `liveThisFrame`. A separate post-queue system
 * (`gcEntityTransformsSystem`, scheduled in `RenderSet.PhaseSort`) drops
 * resources for entities that did not appear in any queue this frame, then
 * clears the set for the next frame. The split means multiple material
 * plugins sharing the cache cannot evict each other's live entries.
 */
export class EntityTransformGpuCache {
  /** `@group(1)` bind-group layout. Lazily created on first use; shared across all materials. */
  layout: BindGroupLayout | undefined;
  /** Per-entity GPU resources. */
  readonly perEntity: Map<
    Entity,
    { buffer: Buffer; bindGroup: BindGroup }
  > = new Map();
  /** Scratch buffer reused for every entity upload. 128 bytes / 32 f32 slots. */
  readonly scratch: Float32Array = new Float32Array(32);
  /**
   * Set of entities touched by any material queue this frame. Populated by
   * {@link ensureEntityTransform}; consumed and cleared by
   * `gcEntityTransformsSystem` once per frame after all queues have run.
   */
  readonly liveThisFrame: Set<Entity> = new Set();
  /**
   * `true` once `MeshTransformGcPlugin` has registered the per-frame GC
   * system against an App. Used by the plugin itself to keep registration
   * idempotent across multiple material plugins inserting it.
   *
   * @internal
   */
  gcSystemRegistered = false;

  getOrCreateLayout(renderer: Renderer): BindGroupLayout {
    if (this.layout !== undefined) return this.layout;
    this.layout = renderer.createBindGroupLayout({
      label: 'entity-transform',
      entries: [
        {
          binding: 0,
          visibility: ShaderStage.VERTEX | ShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
      ],
    });
    return this.layout;
  }
}

const scratchInverse = mat4.identity();

/**
 * Ensure a `(buffer, bindGroup)` slot exists for `entity`, upload `model` and
 * its inverse-transpose into the buffer, mark the entity live for this
 * frame's GC pass, and return the bind group ready to bind at `@group(1)`.
 */
export const ensureEntityTransform = (
  cache: EntityTransformGpuCache,
  renderer: Renderer,
  entity: Entity,
  model: Mat4,
): BindGroup => {
  cache.liveThisFrame.add(entity);
  const layout = cache.getOrCreateLayout(renderer);
  let slots = cache.perEntity.get(entity);
  if (slots === undefined) {
    const buffer = renderer.createBuffer({
      label: `entity-transform#${entity}`,
      size: ENTITY_TRANSFORM_BUFFER_SIZE,
      usage: BufferUsage.UNIFORM | BufferUsage.COPY_DST,
    });
    const bindGroup = renderer.createBindGroup({
      label: `entity-transform#${entity}`,
      layout,
      entries: [{ binding: 0, resource: { buffer } }],
    });
    slots = { buffer, bindGroup };
    cache.perEntity.set(entity, slots);
  }
  cache.scratch.set(model as Float32Array, 0);
  mat4.invert(model, scratchInverse);
  mat4.transpose(scratchInverse, scratchInverse);
  cache.scratch.set(scratchInverse as Float32Array, 16);
  renderer.writeBuffer(slots.buffer, 0, cache.scratch as BufferSource);
  return slots.bindGroup;
};

/**
 * Drop cached resources for entities not touched by any material queue this
 * frame, then clear the live-frame set for the next frame. Run once per frame
 * by `gcEntityTransformsSystem` after every queue system.
 */
export const gcEntityTransforms = (
  cache: EntityTransformGpuCache,
): void => {
  for (const [entity, slots] of cache.perEntity) {
    if (!cache.liveThisFrame.has(entity)) {
      slots.bindGroup.destroy();
      slots.buffer.destroy();
      cache.perEntity.delete(entity);
    }
  }
  cache.liveThisFrame.clear();
};
