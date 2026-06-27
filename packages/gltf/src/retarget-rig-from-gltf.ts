import type {
  BuildRetargetRigOptions,
  HumanoidSlot,
  ReferencePoseBone,
  RetargetSlot,
} from '@retro-engine/engine';
import {
  RetargetRig,
  computeReferencePose,
  slotForBoneName,
} from '@retro-engine/engine';
import type { Quat, Vec3 } from '@retro-engine/math';
import { quat, vec3 } from '@retro-engine/math';

import { gltfNodeTargetId } from './animation-mapping';
import type { Gltf } from './gltf-root';

/**
 * Build a {@link RetargetRig} directly from a loaded {@link Gltf} document,
 * without instantiating it into a world. This is how a clip's *source* rig is
 * recovered for auto-retargeting: the clip carries only a sub-asset reference
 * into its origin model, so the model is loaded and its skeleton read straight
 * from the document's nodes.
 *
 * It mirrors the live `buildHumanoidRetargetRig`: bones are auto-mapped to
 * canonical humanoid slots by name, and each mapped bone's rest pose is captured
 * by forward kinematics over the document's local node transforms, in the
 * scene-root frame (so a container's axis convention does not bias the result).
 * The bone id is the node's document-index id (`gltfNodeTargetId`), matching how
 * the model's own animation clips address that node — so the source rig's slot
 * lookup resolves the clip's track target ids.
 *
 * Pass `opts.referencePose` to hand-author the reference rotation for a slot the
 * direction heuristic reads wrong; omit it for the auto-derived shared pose.
 */
export const buildHumanoidRetargetRigFromGltf = (
  gltf: Gltf,
  name?: string,
  opts: BuildRetargetRigOptions = {},
): RetargetRig => {
  type BindBone = ReferencePoseBone & {
    readonly boneId: string;
    readonly restT: Vec3;
    readonly restR: Quat;
    readonly restS: Vec3;
  };
  const bones: BindBone[] = [];
  const seen = new Set<HumanoidSlot>();

  const visit = (
    nodeIndex: number,
    parentWorldR: Quat,
    parentWorldT: Vec3,
    parentSlot: HumanoidSlot | undefined,
  ): void => {
    const node = gltf.nodes[nodeIndex];
    if (node === undefined) return;
    const local = node.transform;

    const worldR = quat.create();
    const worldT = vec3.create();
    quat.multiply(parentWorldR, local.rotation, worldR);
    // worldT = parentWorldT + parentWorldR · localT
    vec3.add(parentWorldT, vec3.transformQuat(local.translation, parentWorldR, worldT), worldT);

    const slot = node.name !== undefined ? slotForBoneName(node.name) : undefined;
    let childParentSlot = parentSlot;
    if (slot !== undefined && !seen.has(slot)) {
      bones.push({
        slot,
        boneId: gltfNodeTargetId(nodeIndex),
        parentSlot,
        restT: vec3.clone(local.translation),
        restR: quat.clone(local.rotation),
        restS: vec3.clone(local.scale),
        restWorldT: vec3.clone(worldT),
        restWorldR: quat.clone(worldR),
        parentRestWorldR: quat.clone(parentWorldR),
      });
      seen.add(slot);
      childParentSlot = slot;
    }

    for (const child of node.children) visit(child, worldR, worldT, childParentSlot);
  };

  const scene = gltf.defaultScene ?? gltf.scenes[0];
  if (scene !== undefined) {
    for (const root of scene.nodes) {
      visit(root, quat.identity(), vec3.create(0, 0, 0), undefined);
    }
  }

  const reference = computeReferencePose(bones, opts.referencePose);
  const slots: RetargetSlot[] = bones.map((b) => {
    const ref = reference.get(b.slot)!;
    return {
      slot: b.slot,
      boneId: b.boneId,
      restT: b.restT,
      restR: b.restR,
      restS: b.restS,
      restWorldT: b.restWorldT,
      restWorldR: b.restWorldR,
      parentRestWorldR: b.parentRestWorldR,
      refWorldR: ref.refWorldR,
      parentRefWorldR: ref.parentRefWorldR,
    };
  });
  return new RetargetRig(slots, name);
};
