import type { Vec3 } from '@retro-engine/math';
import { vec3 } from '@retro-engine/math';

import { Transform, GlobalTransform } from '../transform';
import { InheritedVisibility, ViewVisibility, Visibility } from '../visibility';

/**
 * Options accepted by the {@link SpotLight3d} constructor. Every field is
 * optional; omitted fields take the documented default.
 */
export interface SpotLight3dOptions {
  /** RGB tint of the light's emission. Linear-space colour. Default `(1, 1, 1)`. */
  color?: Vec3;
  /** Unitless intensity multiplier. Default `1`. */
  intensity?: number;
  /** World-space radius beyond which the contribution falls to zero. Must be `> 0`; default `20`. */
  range?: number;
  /** World-space source radius, softening the near-field falloff. Default `0`. */
  radius?: number;
  /**
   * Half-angle of the cone's fully-lit inner region, in radians. Fragments
   * within this angle of the cone axis get the full radial contribution.
   * Default `Math.PI / 8` (22.5°).
   */
  innerAngle?: number;
  /**
   * Half-angle of the cone's outer edge, in radians. The contribution ramps
   * from full at {@link innerAngle} to zero at this angle. Must be
   * `>= innerAngle`. Default `Math.PI / 4` (45°).
   */
  outerAngle?: number;
}

/**
 * ECS component placing a 3D spot light at the entity's `GlobalTransform`.
 *
 * A spot light is a {@link PointLight3d} masked by an angular cone: the same
 * inverse-square radial attenuation, multiplied by a cone term that ramps from
 * full inside {@link innerAngle} to zero at {@link outerAngle}.
 *
 * The cone points along the entity's **`GlobalTransform` forward axis (−Z)** —
 * aim the light by rotating (or parenting) its entity. There is no explicit
 * direction field; the transform is the single source of truth.
 *
 * Requires `Transform`, `GlobalTransform`, `Visibility`, `InheritedVisibility`,
 * and `ViewVisibility` — spawning a `SpotLight3d` alone auto-attaches the rest.
 * An invisible spot light contributes nothing.
 *
 * @example
 * ```ts
 * import { SpotLight3d, Transform } from '@retro-engine/engine';
 * import { quat, vec3 } from '@retro-engine/math';
 *
 * const t = new Transform(vec3.create(0, 10, 0));
 * // Aim straight down (forward −Z rotated to point at −Y).
 * quat.fromAxisAngle(vec3.create(1, 0, 0), -Math.PI / 2, t.rotation);
 * cmd.spawn(new SpotLight3d({ intensity: 20, range: 40, outerAngle: Math.PI / 5 }), t);
 * ```
 */
export class SpotLight3d {
  color: Vec3;
  intensity: number;
  range: number;
  radius: number;
  innerAngle: number;
  outerAngle: number;

  constructor(options: SpotLight3dOptions = {}) {
    this.color = options.color ?? vec3.create(1, 1, 1);
    this.intensity = options.intensity ?? 1;
    this.range = options.range ?? 20;
    this.radius = options.radius ?? 0;
    this.innerAngle = options.innerAngle ?? Math.PI / 8;
    this.outerAngle = options.outerAngle ?? Math.PI / 4;
  }

  static readonly requires = [
    Transform,
    GlobalTransform,
    Visibility,
    InheritedVisibility,
    ViewVisibility,
  ];
}
