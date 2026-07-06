/** Which simulation space a physics operation targets. */
export type PhysicsDimension = '2d' | '3d';

/**
 * Optional-feature flags a {@link PhysicsBackend} advertises, so engine code can
 * degrade gracefully rather than assume. The same day-1 discipline as the
 * renderer's `RendererCapabilities` — a feature a backend lacks is checked, not
 * assumed present.
 */
export interface PhysicsCapabilities {
  /** Supports 2D simulation. */
  readonly dimensions2d: boolean;
  /** Supports 3D simulation. */
  readonly dimensions3d: boolean;
  /** Continuous collision detection (fast bodies don't tunnel). */
  readonly continuousCollisionDetection: boolean;
  /** Joints / constraints between bodies. */
  readonly joints: boolean;
  /** A built-in kinematic character controller. */
  readonly characterController: boolean;
  /** Raycast queries. */
  readonly raycast: boolean;
  /** Shapecast (swept-shape) queries. */
  readonly shapecast: boolean;
}

/** Capabilities of the {@link NullPhysicsBackend}: nothing is supported. */
export const NULL_PHYSICS_CAPABILITIES: PhysicsCapabilities = {
  dimensions2d: false,
  dimensions3d: false,
  continuousCollisionDetection: false,
  joints: false,
  characterController: false,
  raycast: false,
  shapecast: false,
};
