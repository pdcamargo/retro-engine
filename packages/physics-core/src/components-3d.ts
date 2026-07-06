import type { Vec3 } from '@retro-engine/math';
import { vec3 } from '@retro-engine/math';

import type { RigidBodyType } from './components-2d';

/** A 3D physics body. Pair with a {@link Collider3d} and a `Transform`. */
export class RigidBody3d {
  bodyType: RigidBodyType;

  constructor(bodyType: RigidBodyType = 'dynamic') {
    this.bodyType = bodyType;
  }

  /** A dynamic body (moved by forces and collisions). */
  static dynamic(): RigidBody3d {
    return new RigidBody3d('dynamic');
  }

  /** A kinematic body (moved by velocity/transform only). */
  static kinematic(): RigidBody3d {
    return new RigidBody3d('kinematic');
  }

  /** A static body (never moves). */
  static fixed(): RigidBody3d {
    return new RigidBody3d('static');
  }
}

/** The geometric shape family of a {@link Collider3d}. */
export type ColliderShape3d = 'sphere' | 'cuboid' | 'capsule';

/**
 * A 3D collision shape. Construct via {@link Collider3d.sphere} /
 * {@link Collider3d.cuboid} / {@link Collider3d.capsule}; fields not used by the
 * chosen shape stay at their defaults.
 */
export class Collider3d {
  shape: ColliderShape3d;
  /** Radius for `sphere` / `capsule`. */
  radius: number;
  /** Half-extents for `cuboid`. */
  halfExtents: Vec3;
  /** Half the straight segment length for `capsule` (along Y). */
  halfHeight: number;

  constructor(
    shape: ColliderShape3d = 'sphere',
    radius = 0.5,
    halfExtents: Vec3 = vec3.create(0.5, 0.5, 0.5),
    halfHeight = 0.5,
  ) {
    this.shape = shape;
    this.radius = radius;
    this.halfExtents = halfExtents;
    this.halfHeight = halfHeight;
  }

  /** A sphere collider of the given radius. */
  static sphere(radius: number): Collider3d {
    return new Collider3d('sphere', radius);
  }

  /** An axis-aligned box collider of the given half-extents. */
  static cuboid(hx: number, hy: number, hz: number): Collider3d {
    return new Collider3d('cuboid', 0.5, vec3.create(hx, hy, hz));
  }

  /** A vertical capsule collider (segment along Y, rounded by `radius`). */
  static capsule(halfHeight: number, radius: number): Collider3d {
    return new Collider3d('capsule', radius, vec3.create(radius, halfHeight, radius), halfHeight);
  }
}

/** Linear velocity of a 3D body, in units/second. */
export class LinearVelocity3d {
  value: Vec3;

  constructor(value: Vec3 = vec3.create(0, 0, 0)) {
    this.value = value;
  }
}

/** Angular velocity of a 3D body, in radians/second about each axis. */
export class AngularVelocity3d {
  value: Vec3;

  constructor(value: Vec3 = vec3.create(0, 0, 0)) {
    this.value = value;
  }
}

/** A persistent external force applied to a 3D dynamic body each step. */
export class ExternalForce3d {
  value: Vec3;

  constructor(value: Vec3 = vec3.create(0, 0, 0)) {
    this.value = value;
  }
}
