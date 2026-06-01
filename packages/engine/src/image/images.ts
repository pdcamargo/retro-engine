import { Assets, type Handle } from '@retro-engine/assets';
import { vec4 } from '@retro-engine/math';

import { Image } from './image';

/**
 * App-level store mapping {@link Handle}s to {@link Image} instances.
 *
 * Inserted as a main-world resource by `ImagePlugin`. Gameplay / spawn-time
 * code calls `images.add(image)` to register an image and gets back a
 * `Handle<Image>`; materials and other components hold the handle. The store
 * buffers lifecycle events (`added` / `modified` / `removed`) that the plugin's
 * extract system drains once per frame.
 *
 * Three well-known defaults are seeded by the constructor and exposed as
 * readonly handles: {@link Images.WHITE} (opaque white), {@link Images.BLACK}
 * (opaque black), and {@link Images.NORMAL_FLAT} (a flat normal map,
 * `(0.5, 0.5, 1, 1)`). Bind-group schemas declare a `fallback` (`'white' |
 * 'black' | 'normalFlat'`) so a material referencing an `undefined` image field
 * resolves to the matching default at prepare time.
 */
export class Images extends Assets<Image> {
  /** 1×1 opaque white. Default fallback for colour / metallic-roughness / emissive / occlusion textures. */
  readonly WHITE: Handle<Image>;
  /** 1×1 opaque black. */
  readonly BLACK: Handle<Image>;
  /** 1×1 flat normal map `(0.5, 0.5, 1, 1)` — encodes a straight-up tangent-space normal. Default fallback for normal-map textures. */
  readonly NORMAL_FLAT: Handle<Image>;

  constructor() {
    super();
    // WHITE / BLACK default to colorSpace 'srgb' (the StandardMaterial fallback
    // is used for both color slots — baseColor, emissive — and data slots —
    // metallic-roughness, occlusion). The 0.0 and 1.0 components are invariant
    // under sRGB ↔ linear decode, so an 'srgb' fallback samples correctly
    // through either path.
    this.WHITE = this.add(Image.solid(vec4.create(1, 1, 1, 1), { label: 'image#WHITE' }));
    this.BLACK = this.add(Image.solid(vec4.create(0, 0, 0, 1), { label: 'image#BLACK' }));
    // NORMAL_FLAT must be linear: a `(0.5, 0.5, 1, 1)` literal sRGB-decodes to
    // ~`(0.214, 0.214, 1, 1)` linear, which would corrupt tangent-space normal
    // sampling.
    this.NORMAL_FLAT = this.add(
      Image.solid(vec4.create(0.5, 0.5, 1, 1), {
        label: 'image#NORMAL_FLAT',
        colorSpace: 'linear',
      }),
    );
  }
}
