import type { Entity, World } from '@retro-engine/ecs';
import type { Quat, Vec3 } from '@retro-engine/math';
import { quat, vec3 } from '@retro-engine/math';

import { Children } from '../../hierarchy';
import { Name } from '../../name';
import { Transform } from '../../transform';
import { AnimationTarget } from '../animation-player';
import type { HumanoidSlot } from './humanoid';
import { slotForBoneName } from './humanoid';
import type { AuthoredReferencePose, ReferencePoseBone } from './retarget-reference-pose';
import { computeReferencePose } from './retarget-reference-pose';

/** Options for {@link buildHumanoidRetargetRig}. */
export interface BuildRetargetRigOptions {
  /**
   * Hand-authored reference-pose **world** rotations that override the
   * auto-derived value per slot — the Unreal "retarget pose" escape hatch for a
   * rig whose bind pose the direction heuristic reads wrong. Slots left out keep
   * their derived rotation.
   */
  readonly referencePose?: AuthoredReferencePose;
}

/**
 * One bone of a {@link RetargetRig}: the canonical slot it fills, the id a clip
 * track binds it through, and its **rest** (bind) pose. The rest pose is what a
 * retarget transfers motion relative to, so a clip authored against this rig can
 * land on a differently-proportioned one.
 */
export interface RetargetSlot {
  /** The canonical humanoid slot this bone fills. */
  readonly slot: HumanoidSlot;
  /** The {@link AnimationTarget} id a clip track addresses this bone through (or the bone name). */
  readonly boneId: string;
  /** Rest **local** translation, relative to the bone's parent. */
  readonly restT: Vec3;
  /** Rest **local** rotation, relative to the bone's parent. */
  readonly restR: Quat;
  /** Rest **local** scale. */
  readonly restS: Vec3;
  /** Rest **world** translation — used to derive the proportion (height) ratio. */
  readonly restWorldT: Vec3;
  /** Rest **world** rotation of this bone, in the skeleton-root frame. */
  readonly restWorldR: Quat;
  /** Rest **world** rotation of this bone's parent (identity at the hierarchy root). */
  readonly parentRestWorldR: Quat;
  /**
   * This bone's **world** rotation in the shared *reference pose* (a canonical
   * T-pose both rigs are notionally posed into). The retarget transfers a clip's
   * motion as a deviation from this shared pose rather than from each rig's own
   * bind, so a clip authored on an A-pose rig lands correctly on a T-pose target:
   * at the source's rest the target shows the source's rest shape, not its own
   * bind. Auto-derived from the bind bone directions, or authored as an override.
   */
  readonly refWorldR: Quat;
  /** This bone's parent's **world** rotation in the reference pose. */
  readonly parentRefWorldR: Quat;
}

/**
 * A skeleton's retargeting description: which bone fills each canonical humanoid
 * slot, and that bone's rest pose. The analogue of a Unity humanoid *Avatar* or
 * an Unreal *IK Rig* — built once per rig and reused to retarget any clip onto
 * it (or off it).
 *
 * It carries no entity references, so it is shareable across instances and
 * serializable (`.rerig`); a clip is retargeted with two of these (the source
 * rig the clip was authored for, and the target rig it should play on).
 */
export class RetargetRig {
  /** Slot → its bone entry, for fast lookup during a transfer. */
  readonly bySlot: ReadonlyMap<HumanoidSlot, RetargetSlot>;
  /** Bone id → the slot it fills, for mapping a source clip's tracks to slots. */
  readonly slotByBoneId: ReadonlyMap<string, HumanoidSlot>;

  constructor(
    /** The mapped bones. One entry per filled slot. */
    public readonly slots: readonly RetargetSlot[] = [],
    /** Optional human-readable name carried for tooling. */
    public name?: string,
  ) {
    this.bySlot = new Map(slots.map((s) => [s.slot, s]));
    this.slotByBoneId = new Map(slots.map((s) => [s.boneId, s.slot]));
  }

  /** The entry filling `slot`, or `undefined` if this rig does not map it. */
  slot(slot: HumanoidSlot): RetargetSlot | undefined {
    return this.bySlot.get(slot);
  }
}

/**
 * Build a {@link RetargetRig} from a live skeleton by auto-mapping its bones to
 * canonical humanoid slots by name (Unity's "Configure Avatar" auto-detect) and
 * capturing each mapped bone's rest pose from its current local `Transform`.
 *
 * Call it before any animation drives the rig, so the captured pose is the bind
 * pose. Bones whose names are not recognized humanoid bones are skipped; the
 * first bone matching a slot wins. The bone id is the bone's
 * {@link AnimationTarget} id when present (so a glTF clip's tracks resolve) and
 * otherwise its name.
 *
 * Bind world rotations **and positions** are accumulated by forward kinematics
 * over each bone's local `Transform`, **relative to `skeletonRoot`** (which is
 * treated as the origin with identity rotation). Working in the rig's own root
 * frame makes the result independent of whatever rotation a container above the
 * skeleton (a glTF scene root's axis conversion) carries — two rigs imported with
 * different container conventions still compare correctly. It is also independent
 * of whether `GlobalTransform`s have been propagated this frame. Pass the
 * skeleton's **root bone** as `skeletonRoot`.
 *
 * Each bone's shared reference-pose rotation is then derived from the bind bone
 * directions (see {@link computeReferencePose}); pass `opts.referencePose` to
 * author it by hand for any slot.
 */
export const buildHumanoidRetargetRig = (
  world: World,
  skeletonRoot: Entity,
  name?: string,
  opts: BuildRetargetRigOptions = {},
): RetargetRig => {
  // Bind data captured per mapped bone, plus the nearest mapped ancestor slot,
  // before the reference pose is derived over the whole set.
  type BindBone = ReferencePoseBone & {
    readonly boneId: string;
    readonly restT: Vec3;
    readonly restR: Quat;
    readonly restS: Vec3;
  };
  const bones: BindBone[] = [];
  const seen = new Set<HumanoidSlot>();

  const visit = (
    entity: Entity,
    parentWorldR: Quat,
    parentWorldT: Vec3,
    parentSlot: HumanoidSlot | undefined,
  ): void => {
    const transform = world.getComponent(entity, Transform);
    const worldR = quat.create();
    const worldT = vec3.create();
    if (transform !== undefined) {
      quat.multiply(parentWorldR, transform.rotation, worldR);
      // worldT = parentWorldT + parentWorldR · localT
      vec3.add(parentWorldT, vec3.transformQuat(transform.translation, parentWorldR, worldT), worldT);
    } else {
      quat.copy(parentWorldR, worldR);
      vec3.copy(parentWorldT, worldT);
    }

    const named = world.getComponent(entity, Name);
    const slot = named !== undefined ? slotForBoneName(named.value) : undefined;
    let childParentSlot = parentSlot;
    if (slot !== undefined && !seen.has(slot) && transform !== undefined) {
      const target = world.getComponent(entity, AnimationTarget);
      const boneId = target?.id ?? named!.value;
      bones.push({
        slot,
        boneId,
        parentSlot,
        restT: vec3.clone(transform.translation),
        restR: quat.clone(transform.rotation),
        restS: vec3.clone(transform.scale),
        restWorldT: vec3.clone(worldT),
        restWorldR: quat.clone(worldR),
        parentRestWorldR: quat.clone(parentWorldR),
      });
      seen.add(slot);
      childParentSlot = slot;
    }

    const children = world.getComponent(entity, Children);
    if (children !== undefined) {
      for (const child of children.entities) visit(child, worldR, worldT, childParentSlot);
    }
  };

  visit(skeletonRoot, quat.identity(), vec3.create(0, 0, 0), undefined);

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
