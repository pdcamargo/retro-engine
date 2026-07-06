import type { Quat, Vec2, Vec3 } from '@retro-engine/math';
import { quat, vec2, vec3 } from '@retro-engine/math';

import type { BodyReadback, BodySnapshot, ColliderDesc } from './backend';
import type { Collider2d, LinearVelocity2d, RigidBody2d } from './components-2d';
import type { AngularVelocity3d, Collider3d, LinearVelocity3d, RigidBody3d } from './components-3d';

/** Minimal transform view the bridge reads/writes (satisfied by engine's `Transform`). */
export interface TransformLike {
  translation: Vec3;
  rotation: Quat;
}

/** Convert a 2D collider component to a backend-agnostic {@link ColliderDesc}. */
export const colliderDesc2d = (collider: Collider2d, isSensor: boolean): ColliderDesc => ({
  shape: collider.shape,
  radius: collider.radius,
  halfExtents: [collider.halfExtents[0] ?? 0, collider.halfExtents[1] ?? 0],
  halfHeight: collider.halfHeight,
  isSensor,
});

/** Convert a 3D collider component to a backend-agnostic {@link ColliderDesc}. */
export const colliderDesc3d = (collider: Collider3d, isSensor: boolean): ColliderDesc => ({
  shape: collider.shape,
  radius: collider.radius,
  halfExtents: [
    collider.halfExtents[0] ?? 0,
    collider.halfExtents[1] ?? 0,
    collider.halfExtents[2] ?? 0,
  ],
  halfHeight: collider.halfHeight,
  isSensor,
});

/** The Z-axis angle (radians) of a rotation quaternion — the 2D body's orientation. */
export const angle2dFromQuat = (rotation: Quat): number =>
  2 * Math.atan2(rotation[2] ?? 0, rotation[3] ?? 1);

/** Optional per-body inputs shared by 2D and 3D snapshot builders. */
export interface SnapshotMaterial {
  readonly restitution?: number;
  readonly friction?: number;
  readonly gravityScale?: number;
}

/** Assemble a {@link BodySnapshot} for a 2D body from its components. */
export const snapshot2d = (
  body: RigidBody2d,
  collider: Collider2d,
  transform: TransformLike,
  isSensor: boolean,
  linear: LinearVelocity2d | undefined,
  angular: number,
  externalForce: Vec2 | undefined,
  material: SnapshotMaterial,
): BodySnapshot => ({
  dimension: '2d',
  bodyType: body.bodyType,
  translation: [transform.translation[0] ?? 0, transform.translation[1] ?? 0],
  rotation: [angle2dFromQuat(transform.rotation)],
  collider: colliderDesc2d(collider, isSensor),
  linearVelocity: linear ? [linear.value[0] ?? 0, linear.value[1] ?? 0] : [0, 0],
  angularVelocity: [angular],
  externalForce: externalForce ? [externalForce[0] ?? 0, externalForce[1] ?? 0] : [0, 0],
  restitution: material.restitution ?? 0,
  friction: material.friction ?? 0.5,
  gravityScale: material.gravityScale ?? 1,
});

/** Assemble a {@link BodySnapshot} for a 3D body from its components. */
export const snapshot3d = (
  body: RigidBody3d,
  collider: Collider3d,
  transform: TransformLike,
  isSensor: boolean,
  linear: LinearVelocity3d | undefined,
  angular: AngularVelocity3d | undefined,
  externalForce: Vec3 | undefined,
  material: SnapshotMaterial,
): BodySnapshot => ({
  dimension: '3d',
  bodyType: body.bodyType,
  translation: [
    transform.translation[0] ?? 0,
    transform.translation[1] ?? 0,
    transform.translation[2] ?? 0,
  ],
  rotation: [
    transform.rotation[0] ?? 0,
    transform.rotation[1] ?? 0,
    transform.rotation[2] ?? 0,
    transform.rotation[3] ?? 1,
  ],
  collider: colliderDesc3d(collider, isSensor),
  linearVelocity: linear ? [linear.value[0] ?? 0, linear.value[1] ?? 0, linear.value[2] ?? 0] : [0, 0, 0],
  angularVelocity: angular
    ? [angular.value[0] ?? 0, angular.value[1] ?? 0, angular.value[2] ?? 0]
    : [0, 0, 0],
  externalForce: externalForce
    ? [externalForce[0] ?? 0, externalForce[1] ?? 0, externalForce[2] ?? 0]
    : [0, 0, 0],
  restitution: material.restitution ?? 0,
  friction: material.friction ?? 0.5,
  gravityScale: material.gravityScale ?? 1,
});

/** Write a 2D simulated readback onto the entity's transform + velocity components. */
export const applyReadback2d = (
  readback: BodyReadback,
  transform: TransformLike,
  linear: LinearVelocity2d | undefined,
): void => {
  const angle = readback.rotation[0] ?? 0;
  vec3.set(readback.translation[0] ?? 0, readback.translation[1] ?? 0, transform.translation[2] ?? 0, transform.translation);
  quat.fromEuler(0, 0, angle, 'xyz', transform.rotation);
  if (linear) vec2.set(readback.linearVelocity[0] ?? 0, readback.linearVelocity[1] ?? 0, linear.value);
};

/** Write a 3D simulated readback onto the entity's transform + velocity components. */
export const applyReadback3d = (
  readback: BodyReadback,
  transform: TransformLike,
  linear: LinearVelocity3d | undefined,
  angular: AngularVelocity3d | undefined,
): void => {
  vec3.set(
    readback.translation[0] ?? 0,
    readback.translation[1] ?? 0,
    readback.translation[2] ?? 0,
    transform.translation,
  );
  quat.set(
    readback.rotation[0] ?? 0,
    readback.rotation[1] ?? 0,
    readback.rotation[2] ?? 0,
    readback.rotation[3] ?? 1,
    transform.rotation,
  );
  if (linear) {
    vec3.set(readback.linearVelocity[0] ?? 0, readback.linearVelocity[1] ?? 0, readback.linearVelocity[2] ?? 0, linear.value);
  }
  if (angular) {
    vec3.set(readback.angularVelocity[0] ?? 0, readback.angularVelocity[1] ?? 0, readback.angularVelocity[2] ?? 0, angular.value);
  }
};
