import type { Vec2, Vec3 } from '@retro-engine/math';
import { vec2, vec3 } from '@retro-engine/math';

/**
 * World gravity, read via `Res(Gravity)`. Separate 2D and 3D vectors so a scene
 * mixing both dimensions configures each independently. Defaults approximate
 * Earth gravity pointing down: `(0, -9.81)` in 2D and `(0, -9.81, 0)` in 3D.
 */
export class Gravity {
  /** 2D gravity acceleration (units/s²). */
  gravity2d: Vec2;
  /** 3D gravity acceleration (units/s²). */
  gravity3d: Vec3;

  constructor(gravity2d: Vec2 = vec2.create(0, -9.81), gravity3d: Vec3 = vec3.create(0, -9.81, 0)) {
    this.gravity2d = gravity2d;
    this.gravity3d = gravity3d;
  }
}
