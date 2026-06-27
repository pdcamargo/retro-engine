import type { Entity, World } from '@retro-engine/ecs';
import { mat4, vec3 } from '@retro-engine/math';

import { Children, Parent } from '../hierarchy';
import { Name } from '../name';
import { Skeleton } from '../skinning/skeleton';
import { Transform } from '../transform';
import type { RigPose } from './rig-pose';

/** Options for {@link spawnRig}. */
export interface SpawnRigOptions {
  /** Parent the rig's root bones under this entity (its `Children` is extended in place). */
  root?: Entity;
  /**
   * Bone names parallel to the pose's joint order. When given, each joint entity
   * gets a {@link Name}, so name-based consumers (humanoid retargeting) can map
   * the skeleton.
   */
  names?: readonly string[];
}

/** The entities a {@link spawnRig} call produced, ready to attach to a mesh. */
export interface SpawnedRig {
  /**
   * The joint entities in palette order (the rig's bone order), so a vertex's
   * `JOINTS_0` index addresses both this array and the {@link skeleton}'s
   * matrices.
   */
  readonly joints: Entity[];
  /**
   * A {@link Skeleton} referencing {@link joints} with cloned inverse bind
   * matrices — insert it on the mesh entity to skin it.
   */
  readonly skeleton: Skeleton;
}

/**
 * Spawn a joint-entity hierarchy for a {@link RigPose} and return a
 * {@link Skeleton} bound to it.
 *
 * Each bone becomes an entity carrying its rest-pose local {@link Transform};
 * `Parent`/`Children` edges mirror the rig so transform propagation — and
 * therefore the skinning palette — follows a posed joint down its subtree.
 * Bones are spawned parent-first (the pose is topologically ordered), so a
 * child's parent entity always exists when the child is spawned. When `root` is
 * given, the rig's root bones are parented under it (its `Children` list is
 * extended in place); otherwise they are free roots.
 *
 * The returned {@link SpawnedRig.skeleton} carries fresh inverse-bind copies, so
 * the caller may insert it without aliasing the pose's matrices.
 */
export const spawnRig = (world: World, pose: RigPose, opts: SpawnRigOptions = {}): SpawnedRig => {
  const { root, names } = opts;
  const n = pose.localTranslations.length;
  const joints: Entity[] = [];
  const childrenOf: Entity[][] = Array.from({ length: n }, () => []);
  const rootBones: Entity[] = [];

  for (let i = 0; i < n; i++) {
    const transform = new Transform(vec3.clone(pose.localTranslations[i]!, vec3.create()));
    const parentIdx = pose.parentIndex[i]!;
    const components: object[] = [transform];
    const boneName = names?.[i];
    if (boneName !== undefined) components.push(new Name(boneName));
    if (parentIdx >= 0) components.push(new Parent(joints[parentIdx]!));
    else if (root !== undefined) components.push(new Parent(root));

    const entity = world.spawn(...components);
    joints.push(entity);
    if (parentIdx >= 0) childrenOf[parentIdx]!.push(entity);
    else rootBones.push(entity);
  }

  // Wire each parent's Children so propagation's descendant walk reaches the
  // whole subtree when an ancestor joint is posed.
  for (let i = 0; i < n; i++) {
    const kids = childrenOf[i]!;
    if (kids.length > 0) world.addComponent(joints[i]!, Children, new Children(kids));
  }

  if (root !== undefined && rootBones.length > 0) {
    const existing = world.getComponent(root, Children);
    if (existing !== undefined) existing.entities.push(...rootBones);
    else world.addComponent(root, Children, new Children(rootBones));
  }

  const skeleton = new Skeleton(
    joints,
    pose.inverseBindMatrices.map((m) => mat4.clone(m, mat4.create())),
  );
  return { joints, skeleton };
};
