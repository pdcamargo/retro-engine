import type { Entity, World } from '@retro-engine/ecs';

import { Children } from '../../hierarchy';
import { Name } from '../../name';
import { AnimationTarget } from '../animation-player';
import { slotForBoneName } from './humanoid';
import type { RetargetRig } from './retarget-rig';

/**
 * Tag a target skeleton's humanoid bones with {@link AnimationTarget}s so a
 * retargeted clip binds to them. A clip produced by `retargetClip` addresses
 * each bone by the target rig's bone id; for the normal {@link AnimationPlayer}
 * to resolve those ids, each bone needs a matching `AnimationTarget` pointing at
 * the player entity. glTF models that ship their own animation already carry
 * these tags; a character imported without animation (the common retarget
 * target) does not, so this fills them in.
 *
 * Bones already tagged are left untouched, so it is safe to call on a rig that
 * mixes authored and retargeted clips. `player` defaults to `skeletonRoot` —
 * pass the entity that actually owns the `AnimationPlayer` if it differs.
 */
export const bindRetargetRig = (
  world: World,
  skeletonRoot: Entity,
  rig: RetargetRig,
  player: Entity = skeletonRoot,
): void => {
  const stack: Entity[] = [skeletonRoot];
  while (stack.length > 0) {
    const entity = stack.pop()!;

    const named = world.getComponent(entity, Name);
    const slot = named !== undefined ? slotForBoneName(named.value) : undefined;
    if (slot !== undefined && world.getComponent(entity, AnimationTarget) === undefined) {
      const entry = rig.slot(slot);
      if (entry !== undefined) {
        world.addComponent(entity, AnimationTarget, new AnimationTarget(entry.boneId, player));
      }
    }

    const children = world.getComponent(entity, Children);
    if (children !== undefined) {
      for (const child of children.entities) stack.push(child);
    }
  }
};
