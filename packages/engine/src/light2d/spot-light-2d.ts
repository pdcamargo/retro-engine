import type { Vec2, Vec3 } from '@retro-engine/math';
import { vec2, vec3 } from '@retro-engine/math';

import { Transform, GlobalTransform } from '../transform';
import { InheritedVisibility, ViewVisibility, Visibility } from '../visibility';

/**
 * Options accepted by the {@link SpotLight2d} constructor. Every field is
 * optional; omitted fields take the documented default.
 */
export interface SpotLight2dOptions {
  /** RGB tint of the light's emission. Linear-space colour. Default `(1, 1, 1)`. */
  color?: Vec3;
  /** Unitless intensity multiplier. Default `1`. */
  intensity?: number;
  /** Outer world-space radius beyond which the contribution falls to zero. Must be `> 0`; default `100`. */
  range?: number;
  /** Inner world-space radius within which the radial falloff is at full brightness. Default `0`. */
  radius?: number;
  /**
   * Direction the cone points, in world space. Need not be normalized — it is
   * normalized at pack time. Default `(1, 0)` (pointing along +X).
   */
  direction?: Vec2;
  /**
   * Half-angle of the cone's fully-lit inner region, in radians. Fragments
   * within this angle of {@link direction} get the full radial contribution.
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
 * ECS component placing a 2D spot light at the entity's `GlobalTransform`.
 *
 * A spot light is a {@link PointLight2d} with an angular cone mask: the same
 * radial `1 - smoothstep(radius, range, distance)` falloff, multiplied by an
 * angular term `smoothstep(cos(outerAngle), cos(innerAngle), dot(direction, toFragment))`.
 * Fragments inside the inner cone receive the full radial contribution;
 * between the inner and outer half-angles the contribution ramps to zero;
 * outside the outer cone the light contributes nothing.
 *
 * Requires `Transform`, `GlobalTransform`, `Visibility`, `InheritedVisibility`,
 * and `ViewVisibility` — spawning a `SpotLight2d` alone auto-attaches the rest.
 * An invisible spot light contributes nothing.
 *
 * @example
 * ```ts
 * import { SpotLight2d, Transform } from '@retro-engine/engine';
 * import { vec2, vec3 } from '@retro-engine/math';
 *
 * cmd.spawn(
 *   new SpotLight2d({
 *     color: vec3.create(1, 0.95, 0.8),
 *     intensity: 3,
 *     range: 300,
 *     direction: vec2.create(0, -1),
 *     innerAngle: Math.PI / 10,
 *     outerAngle: Math.PI / 5,
 *   }),
 *   new Transform(vec3.create(0, 200, 0)),
 * );
 * ```
 */
export class SpotLight2d {
  color: Vec3;
  intensity: number;
  range: number;
  radius: number;
  direction: Vec2;
  innerAngle: number;
  outerAngle: number;

  constructor(options: SpotLight2dOptions = {}) {
    this.color = options.color ?? vec3.create(1, 1, 1);
    this.intensity = options.intensity ?? 1;
    this.range = options.range ?? 100;
    this.radius = options.radius ?? 0;
    this.direction = options.direction ?? vec2.create(1, 0);
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
