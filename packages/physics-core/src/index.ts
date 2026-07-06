export type { PhysicsCapabilities, PhysicsDimension } from './capabilities';
export { NULL_PHYSICS_CAPABILITIES } from './capabilities';
export type {
  BodyReadback,
  BodySnapshot,
  CharacterConfig,
  CharacterMovement,
  ColliderDesc,
  PhysicsBackend,
  RaycastHit,
  RaycastQuery,
} from './backend';
export { CollisionEvent } from './backend';
export type { ColliderShape2d, RigidBodyType } from './components-2d';
export {
  AngularVelocity2d,
  CharacterController2d,
  Collider2d,
  ExternalForce2d,
  LinearVelocity2d,
  RigidBody2d,
} from './components-2d';
export type { ColliderShape3d } from './components-3d';
export {
  AngularVelocity3d,
  CharacterController3d,
  Collider3d,
  ExternalForce3d,
  LinearVelocity3d,
  RigidBody3d,
} from './components-3d';
export { Friction, GravityScale, Restitution, Sensor } from './material';
export { Gravity } from './gravity';
export { NullPhysicsBackend } from './null-backend';
export { Physics } from './physics';
export type { SnapshotMaterial, TransformLike } from './bridge';
export {
  angle2dFromQuat,
  applyReadback2d,
  applyReadback3d,
  colliderDesc2d,
  colliderDesc3d,
  snapshot2d,
  snapshot3d,
} from './bridge';
export type { PhysicsPluginOptions } from './physics-plugin';
export { PhysicsPlugin } from './physics-plugin';
