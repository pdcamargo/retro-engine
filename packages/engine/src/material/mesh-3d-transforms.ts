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
 * bind group per `Mesh3d` entity. Reused across frames; the buffer contents
 * are re-uploaded each frame from the entity's `GlobalTransform`.
 *
 * Entries for entities that did not appear in this frame's queue pass are
 * garbage-collected at the end of the pass. Bind groups and buffers are
 * destroyed when GC'd.
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
 * its inverse-transpose into the buffer, and return the bind group ready to
 * bind at `@group(1)`.
 */
export const ensureEntityTransform = (
  cache: EntityTransformGpuCache,
  renderer: Renderer,
  entity: Entity,
  model: Mat4,
): BindGroup => {
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
 * Drop cached resources for entities not present in `liveEntities`. Called at
 * the end of the queue pass each frame.
 */
export const gcEntityTransforms = (
  cache: EntityTransformGpuCache,
  liveEntities: ReadonlySet<Entity>,
): void => {
  for (const [entity, slots] of cache.perEntity) {
    if (!liveEntities.has(entity)) {
      slots.bindGroup.destroy();
      slots.buffer.destroy();
      cache.perEntity.delete(entity);
    }
  }
};
