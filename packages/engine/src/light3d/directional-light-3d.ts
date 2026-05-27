import type { Vec3 } from '@retro-engine/math';
import { vec3 } from '@retro-engine/math';

import { Transform, GlobalTransform } from '../transform';
import { InheritedVisibility, ViewVisibility, Visibility } from '../visibility';

import { CascadeShadowConfig } from './cascade-shadow-config';

/**
 * Options accepted by the {@link DirectionalLight3d} constructor. Every field
 * is optional; omitted fields take the documented default.
 */
export interface DirectionalLight3dOptions {
  /** RGB tint of the light's emission. Linear-space colour. Default `(1, 1, 1)`. */
  color?: Vec3;
  /** Unitless intensity multiplier. Default `1`. */
  intensity?: number;
}

/**
 * ECS component for a 3D directional light — a positionless, infinitely-distant
 * source like the sun. Its rays are parallel and its contribution is constant
 * across the scene: `color * intensity * (N·L)`.
 *
 * The light travels along the entity's **`GlobalTransform` forward axis (−Z)** —
 * aim it by rotating (or parenting) its entity. There is no explicit direction
 * field, and the transform's position is ignored (a directional light has no
 * location).
 *
 * Requires `Transform`, `GlobalTransform`, `Visibility`, `InheritedVisibility`,
 * and `ViewVisibility` for parity with the other 3D light components so
 * visibility toggling works. An invisible directional light contributes nothing.
 * Also requires a {@link CascadeShadowConfig} (auto-inserted with defaults),
 * which drives its cascaded shadow map.
 *
 * @example
 * ```ts
 * import { DirectionalLight3d, Transform } from '@retro-engine/engine';
 * import { quat, vec3 } from '@retro-engine/math';
 *
 * const t = new Transform();
 * // Tilt the sun's forward (−Z) down toward the ground.
 * quat.fromAxisAngle(vec3.create(1, 0, 0), -Math.PI / 3, t.rotation);
 * cmd.spawn(new DirectionalLight3d({ intensity: 3 }), t);
 * ```
 */
export class DirectionalLight3d {
  color: Vec3;
  intensity: number;

  constructor(options: DirectionalLight3dOptions = {}) {
    this.color = options.color ?? vec3.create(1, 1, 1);
    this.intensity = options.intensity ?? 1;
  }

  static readonly requires = [
    Transform,
    GlobalTransform,
    Visibility,
    InheritedVisibility,
    ViewVisibility,
    CascadeShadowConfig,
  ];
}
