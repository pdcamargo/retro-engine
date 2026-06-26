import { AvatarMask } from '../avatar-mask';
import type { HumanoidBodyPart, HumanoidSlot } from './humanoid';
import { HUMANOID_BODY_PARTS } from './humanoid';
import type { RetargetRig } from './retarget-rig';

/**
 * Build an {@link AvatarMask} that includes the bones of the given humanoid body
 * parts on a concrete rig — the humanoid body-part mask (head / arms / legs by
 * silhouette). It resolves each part to its canonical slots and each slot to
 * `rig`'s bone id, so the result is an ordinary bone-id include set an animation
 * layer can use directly. Slots the rig does not map are skipped.
 *
 * This is the "sugar" form of an avatar mask: pick body parts instead of
 * individual bones. `humanoidBodyPartMask(rig, ['leftArm', 'rightArm'])` is the
 * upper-body arm mask for a layered wave over a full-body base.
 */
export const humanoidBodyPartMask = (
  rig: RetargetRig,
  parts: readonly HumanoidBodyPart[],
  name?: string,
): AvatarMask => {
  const slots = new Set<HumanoidSlot>();
  for (const part of parts) {
    for (const slot of HUMANOID_BODY_PARTS[part]) slots.add(slot);
  }
  const ids: string[] = [];
  for (const slot of slots) {
    const entry = rig.slot(slot);
    if (entry !== undefined) ids.push(entry.boneId);
  }
  return new AvatarMask(ids, name);
};
