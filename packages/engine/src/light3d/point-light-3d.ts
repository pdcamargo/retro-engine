import type { Vec3 } from '@retro-engine/math';
import { vec3 } from '@retro-engine/math';

import { Transform, GlobalTransform } from '../transform';
import { InheritedVisibility, ViewVisibility, Visibility } from '../visibility';

/**
 * Options accepted by the {@link PointLight3d} constructor. Every field is
 * optional; omitted fields take the documented default.
 */
export interface PointLight3dOptions {
  /** RGB tint of the light's emission. Linear-space colour. Default `(1, 1, 1)`. */
  color?: Vec3;
  /**
   * Unitless intensity multiplier applied to `color`. No physical units are
   * assumed (no Lumens, no Watts) — tuning is the consumer's responsibility.
   * Default `1`.
   */
  intensity?: number;
  /**
   * World-space radius beyond which the contribution falls to zero. Drives the
   * inverse-square attenuation cutoff. Must be `> 0`; default `20`.
   */
  range?: number;
  /**
   * World-space source radius. Softens the near-field inverse-square falloff so
   * a fragment very close to the light does not blow out. Default `0` (idealised
   * point source).
   */
  radius?: number;
}

/**
 * ECS component placing a 3D point light at the entity's `GlobalTransform`.
 *
 * A point light radiates equally in all directions from its world position. Its
 * contribution to a lit surface is `color * intensity * attenuation * (N·L)`,
 * where attenuation is inverse-square, clamped to zero at {@link range} and
 * smoothed near the source by {@link radius}.
 *
 * `PointLight3d` requires `Transform`, `GlobalTransform`, `Visibility`,
 * `InheritedVisibility`, and `ViewVisibility` — spawning a `PointLight3d` alone
 * auto-attaches the rest. The visibility chain participates in culling exactly
 * like meshes; an invisible light contributes nothing.
 *
 * Lighting is opt-in: lit materials (e.g. `StandardMaterial`) only read light
 * components when a `Light3dPlugin` is registered on the App.
 *
 * @example
 * ```ts
 * import { PointLight3d, Transform } from '@retro-engine/engine';
 * import { vec3 } from '@retro-engine/math';
 *
 * cmd.spawn(
 *   new PointLight3d({ color: vec3.create(1, 0.9, 0.6), intensity: 8, range: 30 }),
 *   new Transform(vec3.create(0, 5, 0)),
 * );
 * ```
 */
export class PointLight3d {
  color: Vec3;
  intensity: number;
  range: number;
  radius: number;

  constructor(options: PointLight3dOptions = {}) {
    this.color = options.color ?? vec3.create(1, 1, 1);
    this.intensity = options.intensity ?? 1;
    this.range = options.range ?? 20;
    this.radius = options.radius ?? 0;
  }

  static readonly requires = [
    Transform,
    GlobalTransform,
    Visibility,
    InheritedVisibility,
    ViewVisibility,
  ];
}
