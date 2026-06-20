import type { Entity } from '@retro-engine/ecs';
import type { Handle } from '@retro-engine/assets';
import type { Mat4 } from '@retro-engine/math';

import type { Image } from '../image/image';

/** One camera's extracted skybox parameters, ready for the render node. */
export interface ExtractedSkybox {
  /** Cube image to sample. */
  readonly image: Handle<Image>;
  /** Linear color multiplier. */
  readonly brightness: number;
  /** Rotation matrix baked from the component's quaternion at extract time. */
  readonly rotation: Mat4;
}

/**
 * Render-world resource holding the per-camera skybox parameters extracted from
 * the main world each frame. Keyed by the stable main-world camera entity;
 * rebuilt every frame in `RenderSet.Extract` and read by the skybox pass node.
 *
 * @internal
 */
export class ViewSkybox {
  readonly byCamera: Map<Entity, ExtractedSkybox> = new Map();
}
