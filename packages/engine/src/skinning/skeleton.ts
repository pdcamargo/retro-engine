import type { Entity } from '@retro-engine/ecs';
import { mat4 } from '@retro-engine/math';
import type { Mat4 } from '@retro-engine/math';

/**
 * The skeleton that deforms a skinned mesh: the ordered joint entities (palette
 * order) and the parallel inverse bind matrices that map mesh-space vertices
 * into each joint's local space.
 *
 * Attached to the mesh entity. The i-th {@link joints} entity pairs with the
 * i-th {@link inverseBindMatrices} entry; a skinned vertex addresses joints by
 * their index in these arrays. This is authored state — it survives a saved
 * scene and a code reload. The per-frame joint palette derived from it is not
 * (see {@link SkinnedMeshPalette}).
 */
export class Skeleton {
  constructor(
    /** Joint entities in palette order. */
    public joints: Entity[] = [],
    /** Inverse bind matrices, parallel to {@link joints}. */
    public inverseBindMatrices: Mat4[] = [],
  ) {}
}

/**
 * The world-space joint matrices a skinned mesh's vertices blend, recomputed
 * from the current pose every frame: `data[i] = inverse(meshGlobal) ·
 * jointGlobal[i] · inverseBind[i]`, sixteen column-major floats per joint.
 *
 * Derived, transient state — never serialized. Held in the {@link SkinnedPalettes}
 * resource rather than as a stored component so the per-frame recompute and the
 * GPU upload touch a plain map, not the archetype storage.
 */
export class SkinnedMeshPalette {
  /** `jointCount × 16` column-major floats. */
  readonly data: Float32Array;

  constructor(public readonly jointCount: number) {
    this.data = new Float32Array(jointCount * 16);
  }

  /** Reset every joint matrix to identity (used when a joint entity is missing). */
  identity(): void {
    const id = mat4.identity();
    for (let i = 0; i < this.jointCount; i++) this.data.set(id, i * 16);
  }
}
