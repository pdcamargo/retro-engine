/**
 * Bounciness of a body's collisions, `[0, 1]`: `0` = no bounce, `1` = fully
 * elastic. Dimension-agnostic — used by both 2D and 3D bodies.
 */
export class Restitution {
  coefficient: number;

  constructor(coefficient = 0) {
    this.coefficient = coefficient;
  }
}

/**
 * Surface friction of a body, `[0, ∞)` (typically `[0, 1]`): `0` = frictionless.
 * Dimension-agnostic.
 */
export class Friction {
  coefficient: number;

  constructor(coefficient = 0.5) {
    this.coefficient = coefficient;
  }
}

/**
 * Per-body multiplier on world gravity. `1` = normal, `0` = unaffected by
 * gravity, negative = floats up. Dimension-agnostic.
 */
export class GravityScale {
  value: number;

  constructor(value = 1) {
    this.value = value;
  }
}

/**
 * Marks a collider as a **sensor**: it reports overlaps (collision events) but
 * does not physically push bodies or contribute mass. Dimension-agnostic marker.
 */
export class Sensor {}
