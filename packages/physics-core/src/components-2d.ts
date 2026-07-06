import type { Vec2 } from '@retro-engine/math';
import { vec2 } from '@retro-engine/math';

/**
 * How a body participates in the simulation:
 * - `'dynamic'` — moved by forces, gravity, and collisions.
 * - `'kinematic'` — moved only by its velocity / transform (drives others, is
 *   not pushed back).
 * - `'static'` — never moves (floors, walls).
 */
export type RigidBodyType = 'dynamic' | 'kinematic' | 'static';

/** A 2D physics body. Pair with a {@link Collider2d} and a `Transform`. */
export class RigidBody2d {
  bodyType: RigidBodyType;

  constructor(bodyType: RigidBodyType = 'dynamic') {
    this.bodyType = bodyType;
  }

  /** A dynamic body (moved by forces and collisions). */
  static dynamic(): RigidBody2d {
    return new RigidBody2d('dynamic');
  }

  /** A kinematic body (moved by velocity/transform only). */
  static kinematic(): RigidBody2d {
    return new RigidBody2d('kinematic');
  }

  /** A static body (never moves). */
  static fixed(): RigidBody2d {
    return new RigidBody2d('static');
  }
}

/** The geometric shape family of a {@link Collider2d}. */
export type ColliderShape2d = 'circle' | 'rectangle' | 'capsule';

/**
 * A 2D collision shape. Construct via {@link Collider2d.circle} /
 * {@link Collider2d.rectangle} / {@link Collider2d.capsule}; the fields not used
 * by the chosen shape stay at their defaults.
 */
export class Collider2d {
  shape: ColliderShape2d;
  /** Radius for `circle` / `capsule`. */
  radius: number;
  /** Half-width/height for `rectangle`. */
  halfExtents: Vec2;
  /** Half the straight segment length for `capsule` (along Y). */
  halfHeight: number;

  constructor(
    shape: ColliderShape2d = 'circle',
    radius = 0.5,
    halfExtents: Vec2 = vec2.create(0.5, 0.5),
    halfHeight = 0.5,
  ) {
    this.shape = shape;
    this.radius = radius;
    this.halfExtents = halfExtents;
    this.halfHeight = halfHeight;
  }

  /** A circle collider of the given radius. */
  static circle(radius: number): Collider2d {
    return new Collider2d('circle', radius);
  }

  /** An axis-aligned rectangle collider of the given half-extents. */
  static rectangle(halfWidth: number, halfHeight: number): Collider2d {
    return new Collider2d('rectangle', 0.5, vec2.create(halfWidth, halfHeight));
  }

  /** A vertical capsule collider (segment along Y, rounded by `radius`). */
  static capsule(halfHeight: number, radius: number): Collider2d {
    return new Collider2d('capsule', radius, vec2.create(radius, halfHeight), halfHeight);
  }
}

/** Linear velocity of a 2D body, in units/second. */
export class LinearVelocity2d {
  value: Vec2;

  constructor(value: Vec2 = vec2.create(0, 0)) {
    this.value = value;
  }
}

/** Angular velocity of a 2D body, in radians/second (scalar — rotation is about Z). */
export class AngularVelocity2d {
  value: number;

  constructor(value = 0) {
    this.value = value;
  }
}

/** A persistent external force applied to a 2D dynamic body each step. */
export class ExternalForce2d {
  value: Vec2;

  constructor(value: Vec2 = vec2.create(0, 0)) {
    this.value = value;
  }
}

/**
 * A kinematic 2D character controller (collide-and-slide). Attach alongside a
 * kinematic {@link RigidBody2d} + {@link Collider2d}; set
 * {@link CharacterController2d.desiredTranslation} each frame and the physics
 * bridge moves the character by the collision-corrected amount, reporting
 * {@link CharacterController2d.grounded}. Authored fields (offset, slope limits,
 * autostep, snap-to-ground, up) serialize; the per-frame input/output do not.
 */
export class CharacterController2d {
  /** Skin width kept between the character and the environment. */
  offset: number;
  /** Up direction (gravity is "down" the opposite way). */
  up: Vec2;
  /** Steepest slope (radians) the character can climb. */
  maxSlopeClimbAngle: number;
  /** Shallowest slope (radians) that still causes sliding. */
  minSlopeSlideAngle: number;
  /** Max step height to auto-climb; `0` disables autostep. */
  autostepHeight: number;
  /** Minimum step width for autostep. */
  autostepMinWidth: number;
  /** Distance to snap down to ground when descending; `0` disables. */
  snapToGroundDistance: number;

  /** Runtime input: desired movement this frame. Reset to zero after each move. Not serialized. */
  desiredTranslation: Vec2 = vec2.create(0, 0);
  /** Runtime output: whether the character is grounded after the last move. Not serialized. */
  grounded = false;

  constructor(
    options: {
      offset?: number;
      up?: Vec2;
      maxSlopeClimbAngle?: number;
      minSlopeSlideAngle?: number;
      autostepHeight?: number;
      autostepMinWidth?: number;
      snapToGroundDistance?: number;
    } = {},
  ) {
    this.offset = options.offset ?? 0.01;
    this.up = options.up ?? vec2.create(0, 1);
    this.maxSlopeClimbAngle = options.maxSlopeClimbAngle ?? (45 * Math.PI) / 180;
    this.minSlopeSlideAngle = options.minSlopeSlideAngle ?? (30 * Math.PI) / 180;
    this.autostepHeight = options.autostepHeight ?? 0;
    this.autostepMinWidth = options.autostepMinWidth ?? 0;
    this.snapToGroundDistance = options.snapToGroundDistance ?? 0;
  }
}
