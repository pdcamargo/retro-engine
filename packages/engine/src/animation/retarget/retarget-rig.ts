import type { Entity, World } from '@retro-engine/ecs';
import type { Quat, Vec3 } from '@retro-engine/math';
import { quat, vec3 } from '@retro-engine/math';

import { Children } from '../../hierarchy';
import { Name } from '../../name';
import { Transform } from '../../transform';
import { AnimationTarget } from '../animation-player';
import type { HumanoidSlot } from './humanoid';
import { slotForBoneName } from './humanoid';

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
  /**
   * Rest **world** rotation of this bone. The world-space transfer re-bases a
   * source clip's rotation through both rigs' bind world rotations, so motion
   * crosses skeletons whose bones rest in different orientations (e.g. an
   * animation pack rigged in a different bind convention than the target).
   */
  readonly restWorldR: Quat;
  /** Rest **world** rotation of this bone's parent (identity at the hierarchy root). */
  readonly parentRestWorldR: Quat;
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
 */
export const buildHumanoidRetargetRig = (
  world: World,
  skeletonRoot: Entity,
  name?: string,
): RetargetRig => {
  const slots: RetargetSlot[] = [];
  const seen = new Set<HumanoidSlot>();

  const visit = (entity: Entity, parentWorldR: Quat, parentWorldT: Vec3): void => {
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
    if (slot !== undefined && !seen.has(slot) && transform !== undefined) {
      const target = world.getComponent(entity, AnimationTarget);
      const boneId = target?.id ?? named!.value;
      slots.push({
        slot,
        boneId,
        restT: vec3.clone(transform.translation),
        restR: quat.clone(transform.rotation),
        restS: vec3.clone(transform.scale),
        restWorldT: vec3.clone(worldT),
        restWorldR: quat.clone(worldR),
        parentRestWorldR: quat.clone(parentWorldR),
      });
      seen.add(slot);
    }

    const children = world.getComponent(entity, Children);
    if (children !== undefined) {
      for (const child of children.entities) visit(child, worldR, worldT);
    }
  };

  visit(skeletonRoot, quat.identity(), vec3.create(0, 0, 0));
  return new RetargetRig(slots, name);
};
