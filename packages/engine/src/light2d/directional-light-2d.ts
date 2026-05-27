import type { Vec2, Vec3 } from '@retro-engine/math';
import { vec2, vec3 } from '@retro-engine/math';

import { Transform, GlobalTransform } from '../transform';
import { InheritedVisibility, ViewVisibility, Visibility } from '../visibility';

/**
 * Options accepted by the {@link DirectionalLight2d} constructor. Every field
 * is optional; omitted fields take the documented default.
 */
export interface DirectionalLight2dOptions {
  /** RGB tint of the light's emission. Linear-space colour. Default `(1, 1, 1)`. */
  color?: Vec3;
  /** Unitless intensity multiplier. Default `1`. */
  intensity?: number;
  /**
   * Direction the light travels, in world space. Need not be normalized — it
   * is normalized at pack time. Default `(0, -1)` (pointing down, sun-like).
   *
   * Without a normal map the direction has no visible effect — a directional
   * light is a uniform full-screen wash. The direction only modulates shading
   * once normal-map-aware lighting is enabled and surfaces carry per-pixel
   * normals.
   */
  direction?: Vec2;
}

/**
 * ECS component for a 2D directional light — a positionless, uniform light
 * with a single world-space direction, modelling a far-away source like the
 * sun.
 *
 * The contribution covers the entire camera view at constant
 * `color * intensity`. Its {@link direction} only becomes visible once
 * normal-map-aware lighting is enabled and surfaces provide per-pixel normals;
 * until then a `DirectionalLight2d` reads as a flat directional ambient tint
 * (functionally a full-screen add, like a global ambient you can colour and
 * aim).
 *
 * Requires `Transform`, `GlobalTransform`, `Visibility`, `InheritedVisibility`,
 * and `ViewVisibility` for parity with the other 2D light components (the
 * transform is ignored — a directional light has no position). An invisible
 * directional light contributes nothing.
 *
 * @example
 * ```ts
 * import { DirectionalLight2d } from '@retro-engine/engine';
 * import { vec2, vec3 } from '@retro-engine/math';
 *
 * cmd.spawn(
 *   new DirectionalLight2d({
 *     color: vec3.create(0.9, 0.95, 1),
 *     intensity: 0.6,
 *     direction: vec2.create(-0.4, -1),
 *   }),
 * );
 * ```
 */
export class DirectionalLight2d {
  color: Vec3;
  intensity: number;
  direction: Vec2;

  constructor(options: DirectionalLight2dOptions = {}) {
    this.color = options.color ?? vec3.create(1, 1, 1);
    this.intensity = options.intensity ?? 1;
    this.direction = options.direction ?? vec2.create(0, -1);
  }

  static readonly requires = [
    Transform,
    GlobalTransform,
    Visibility,
    InheritedVisibility,
    ViewVisibility,
  ];
}
