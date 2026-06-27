import { mat4, vec3 } from '@retro-engine/math';
import type { Mat4, Vec3 } from '@retro-engine/math';

import type { MakeHumanRig } from './makehuman-rig';

/**
 * The rest pose of a {@link MakeHumanRig} expressed for skinning: each joint's
 * local transform (relative to its parent), the parent index chain, and the
 * inverse bind matrices that map mesh-space vertices into each joint's space.
 *
 * Indices are joint indices — the rig's bone order — so a vertex's `JOINTS_0`
 * value indexes directly into all three arrays and into a {@link Skeleton}'s
 * joint-entity list.
 */
export interface RigPose {
  /** Per joint: its parent's joint index, or `-1` for a root. */
  readonly parentIndex: Int32Array;
  /**
   * Per joint: the local translation relative to its parent (`head - parentHead`,
   * or `head` for a root). Rotation is identity and scale is one in the rest
   * pose, so only the translation needs carrying.
   */
  readonly localTranslations: Vec3[];
  /**
   * Per joint: the inverse bind matrix, `inverse(translate(head))`. The rest
   * global of joint `i` is `translate(head_i)`, so this maps a mesh-space vertex
   * into joint `i`'s local space — exactly the `inverseBindMatrices` a
   * {@link Skeleton} consumes.
   */
  readonly inverseBindMatrices: Mat4[];
}

/**
 * Derive the skinning rest pose of a {@link MakeHumanRig}.
 *
 * A MakeHuman bone carries only world-space `head`/`tail` positions and a parent
 * name; the rest pose treats each joint's rest global as a pure translation to
 * its `head` (no rest rotation), which is the convention the `.target`-driven
 * base mesh and the joint-palette skinning path both assume. Local translation
 * is therefore the head offset from the parent's head, and the inverse bind is
 * the inverse of the rest global. Bones must be topologically ordered (every
 * bone after its parent), which {@link parseMakeHumanRig} guarantees.
 */
export const buildRigPose = (rig: MakeHumanRig): RigPose => {
  const n = rig.bones.length;
  const parentIndex = new Int32Array(n);
  const localTranslations: Vec3[] = [];
  const inverseBindMatrices: Mat4[] = [];

  for (let i = 0; i < n; i++) {
    const bone = rig.bones[i]!;
    const parentIdx = bone.parent !== null ? rig.indexOf.get(bone.parent)! : -1;
    parentIndex[i] = parentIdx;

    if (parentIdx >= 0) {
      const parentHead = rig.bones[parentIdx]!.head;
      localTranslations.push(vec3.subtract(bone.head, parentHead, vec3.create()));
    } else {
      localTranslations.push(vec3.clone(bone.head, vec3.create()));
    }

    inverseBindMatrices.push(mat4.inverse(mat4.translation(bone.head), mat4.create()));
  }

  return { parentIndex, localTranslations, inverseBindMatrices };
};
