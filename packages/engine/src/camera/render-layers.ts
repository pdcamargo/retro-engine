/**
 * Bitmask component declaring which render layers an entity (or camera) belongs
 * to. A camera renders an entity only when their masks intersect — i.e. both
 * carry at least one bit in common. Entities or cameras without a
 * `RenderLayers` component default to layer 0 (mask `0b1`); the canonical
 * "everything on layer 0" arrangement is therefore the no-config path.
 *
 * The mask is a 32-bit unsigned integer — 32 layers, indexed `0..31`. Higher
 * layer indices need additional storage; not in v1.
 *
 * The visibility *check* (`(camera.layers & entity.layers) !== 0`) is wired in
 * the visibility/culling phase. This component ships earlier so cameras and
 * renderables can declare layers up-front without two-step migration once
 * culling lands.
 *
 * @example
 * ```ts
 * // A UI overlay camera that only sees layer 1 entities.
 * cmd.spawn(...Camera2d({ order: 10 }), RenderLayers.layer(1));
 *
 * // Sprite that's visible to both the world camera (layer 0) and the UI camera (layer 1).
 * cmd.spawn(new Transform(), new Sprite(...), RenderLayers.layers(0, 1));
 * ```
 */
export class RenderLayers {
  /** Layer-0-only mask, used as the implicit default when the component is absent. */
  static readonly DEFAULT_MASK = 0b1 as const;

  /** Raw bitmask. Bit `n` set ⇔ membership in layer `n`. */
  mask: number;

  constructor(mask: number = RenderLayers.DEFAULT_MASK) {
    this.mask = mask >>> 0;
  }

  /** Single-layer mask. `RenderLayers.layer(3)` → mask `0b1000`. */
  static layer(n: number): RenderLayers {
    return new RenderLayers((1 << n) >>> 0);
  }

  /** Multi-layer mask. `RenderLayers.layers(0, 2)` → mask `0b101`. */
  static layers(...ns: number[]): RenderLayers {
    let m = 0;
    for (const n of ns) m |= 1 << n;
    return new RenderLayers(m >>> 0);
  }
}

/**
 * Returns `true` iff the two masks share at least one bit. Absent components
 * are treated as the default layer-0-only mask, so calling this with `undefined`
 * on either side returns whether the other side includes layer 0.
 */
export const renderLayersIntersect = (
  a: RenderLayers | undefined,
  b: RenderLayers | undefined,
): boolean => {
  const am = a?.mask ?? RenderLayers.DEFAULT_MASK;
  const bm = b?.mask ?? RenderLayers.DEFAULT_MASK;
  return (am & bm) !== 0;
};
