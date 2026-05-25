import type { Vec2, Vec4 } from '@retro-engine/math';
import { vec2, vec4 } from '@retro-engine/math';

import type { ImageHandle } from '../image/images';
import { Transform, GlobalTransform } from '../transform';
import { InheritedVisibility, ViewVisibility, Visibility } from '../visibility';

/**
 * Where on a sprite's footprint its origin sits, in normalised footprint
 * coordinates. The named values mirror Bevy:
 *
 * - `'center'`     = `(0.5, 0.5)` — the default.
 * - `'topLeft'`    = `(0, 1)`.
 * - `'topRight'`   = `(1, 1)`.
 * - `'bottomLeft'` = `(0, 0)`.
 * - `'bottomRight'`= `(1, 0)`.
 *
 * The Y axis is up — `(0, 1)` is the *top*-left corner, matching the
 * screen-space convention an orthographic 2D camera produces. A custom
 * `{ x, y }` is interpreted in the same `[0, 1]` × `[0, 1]` space, but values
 * outside the unit square are allowed (anchors at e.g. `(0.5, 1.2)` offset
 * the sprite above its nominal top).
 */
export type SpriteAnchor =
  | 'center'
  | 'topLeft'
  | 'topRight'
  | 'bottomLeft'
  | 'bottomRight'
  | { readonly x: number; readonly y: number };

/**
 * Sub-rectangle within a source image, in normalised UV coordinates
 * (`[0, 1]` on both axes). `min` is the lower-left corner and `max` is the
 * upper-right. Pass a `Rect` to {@link Sprite.rect} to render only a portion
 * of the source image — the foundation that a texture atlas writes per frame.
 */
export class Rect {
  readonly min: Vec2;
  readonly max: Vec2;

  constructor(min: Vec2, max: Vec2) {
    this.min = min;
    this.max = max;
  }

  /** Full-image rect: `[0, 0]` to `[1, 1]`. */
  static full(): Rect {
    return new Rect(vec2.create(0, 0), vec2.create(1, 1));
  }
}

/**
 * Options accepted by the {@link Sprite} constructor. Every field is
 * optional; omitted fields take the documented default.
 */
export interface SpriteOptions {
  /**
   * Source image handle. `undefined` resolves to `Images.WHITE` at queue time,
   * producing a solid-colour quad tinted by {@link color}.
   */
  image?: ImageHandle;
  /** RGBA tint multiplied with the sampled texel. Default `(1, 1, 1, 1)`. */
  color?: Vec4;
  /**
   * Footprint size in world units. Omit to use the source image's natural
   * pixel dimensions; required when `image` is `undefined` (the default
   * `Images.WHITE` is `1 × 1`, so an undefined `customSize` produces a 1-unit
   * sprite which is usually not what the consumer wants for a solid-colour
   * tint).
   */
  customSize?: Vec2;
  /** Sub-rect within the source image. Omit to use the full image. */
  rect?: Rect;
  /** Origin within the footprint. Default `'center'`. */
  anchor?: SpriteAnchor;
  /** Flip the source UV along the X axis. Default `false`. */
  flipX?: boolean;
  /** Flip the source UV along the Y axis. Default `false`. */
  flipY?: boolean;
}

/**
 * ECS component pairing an entity to a {@link Image} asset rendered as a
 * camera-facing quad. Spawning a `Sprite` makes the entity drawable as a 2D
 * sprite; the entity's `GlobalTransform` controls position, rotation, and
 * scale.
 *
 * `Sprite` requires `Transform`, `GlobalTransform`, `Visibility`,
 * `InheritedVisibility`, and `ViewVisibility` — spawning with `new Sprite(...)`
 * alone auto-attaches the rest via the engine's required-component
 * resolution.
 *
 * The held {@link image} is opaque; `undefined` resolves to `Images.WHITE` at
 * queue time, so `new Sprite({ color, customSize })` produces a solid-colour
 * quad without any image plumbing.
 *
 * @example
 * ```ts
 * // Solid-colour quad, 32×32 world units, tinted red.
 * cmd.spawn(
 *   new Sprite({
 *     color: vec4.create(1, 0.2, 0.2, 1),
 *     customSize: vec2.create(32, 32),
 *   }),
 * );
 *
 * // Image sprite at a parented transform.
 * const handle = world.getResource(Images)!.add(Image.fromBytes(...));
 * cmd.spawn(new Sprite({ image: handle }));
 * ```
 */
export class Sprite {
  image: ImageHandle | undefined;
  color: Vec4;
  customSize: Vec2 | undefined;
  rect: Rect | undefined;
  anchor: SpriteAnchor;
  flipX: boolean;
  flipY: boolean;

  constructor(options: SpriteOptions = {}) {
    this.image = options.image;
    this.color = options.color ?? vec4.create(1, 1, 1, 1);
    this.customSize = options.customSize;
    this.rect = options.rect;
    this.anchor = options.anchor ?? 'center';
    this.flipX = options.flipX ?? false;
    this.flipY = options.flipY ?? false;
  }

  static readonly requires = [
    Transform,
    GlobalTransform,
    Visibility,
    InheritedVisibility,
    ViewVisibility,
  ];
}

/**
 * Resolve a {@link SpriteAnchor} into its `[ax, ay]` numeric coordinates in
 * `[0, 1]` × `[0, 1]` footprint space (Y up). Used by the sprite-batch
 * packer to compute the position of the unit-quad's `(0, 0)` corner relative
 * to the entity origin.
 *
 * @internal
 */
export const resolveAnchor = (anchor: SpriteAnchor): readonly [number, number] => {
  if (typeof anchor === 'string') {
    switch (anchor) {
      case 'center':
        return [0.5, 0.5];
      case 'topLeft':
        return [0, 1];
      case 'topRight':
        return [1, 1];
      case 'bottomLeft':
        return [0, 0];
      case 'bottomRight':
        return [1, 0];
    }
  }
  return [anchor.x, anchor.y];
};
