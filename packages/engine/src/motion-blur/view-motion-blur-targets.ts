import type { Entity } from '@retro-engine/ecs';
import type {
  Buffer,
  ResolvedRenderTarget,
  Texture,
  TextureFormat,
  TextureView,
} from '@retro-engine/renderer-core';
import { BufferUsage, TextureUsage } from '@retro-engine/renderer-core';

import type { App } from '../index';

/**
 * Format of the per-camera motion-blur output intermediate. Matches the HDR
 * intermediate (`rgba16float`) so the downstream tonemap pass reads the blurred
 * scene at the same precision it would read the un-blurred HDR target.
 */
export const MOTION_BLUR_TARGET_FORMAT: TextureFormat = 'rgba16float';

/** Byte size of the motion-blur params uniform: `samples:u32`, `velocity_scale:f32`, `max_velocity:f32`, pad. */
export const MOTION_BLUR_PARAMS_BYTE_SIZE = 16 as const;

/**
 * Per-camera GPU resources for the motion-blur pass: the sampleable
 * `rgba16float` output intermediate the blur writes (and tonemap then reads)
 * plus the params uniform buffer. Owns the texture; do not destroy the view
 * elsewhere.
 *
 * @internal
 */
export interface MotionBlurCacheEntry {
  texture: Texture;
  view: TextureView;
  width: number;
  height: number;
  paramsBuffer: Buffer;
}

/**
 * Render-world resource caching each motion-blur camera's output intermediate
 * and params buffer across frames, keyed by main-world camera `sourceEntity`.
 * Allocated / reused / evicted by `MotionBlurPlugin`'s prepare system.
 *
 * @internal
 */
export class ViewMotionBlurTargets {
  readonly perCamera: Map<Entity, MotionBlurCacheEntry> = new Map();
}

/**
 * Allocate (or reuse) the motion-blur output intermediate and params buffer for
 * a camera, sized to `color`. Reallocates the texture on a size change; the
 * params buffer is created once and reused. Returns the output as a
 * {@link ResolvedRenderTarget} the node renders into.
 *
 * @internal
 */
export const resolveMotionBlurTarget = (
  cache: ViewMotionBlurTargets,
  app: App,
  sourceEntity: Entity,
  color: ResolvedRenderTarget,
): ResolvedRenderTarget => {
  const { width, height } = color;
  const existing = cache.perCamera.get(sourceEntity);
  if (existing !== undefined && existing.width === width && existing.height === height) {
    return { view: existing.view, format: MOTION_BLUR_TARGET_FORMAT, width, height };
  }
  if (existing !== undefined) {
    existing.view.destroy();
    existing.texture.destroy();
  }
  const texture = app.renderer.createTexture({
    label: `view-motion-blur#${sourceEntity}`,
    width,
    height,
    format: MOTION_BLUR_TARGET_FORMAT,
    usage: TextureUsage.RENDER_ATTACHMENT | TextureUsage.TEXTURE_BINDING,
  });
  const view = texture.createView();
  const paramsBuffer =
    existing?.paramsBuffer ??
    app.renderer.createBuffer({
      label: `view-motion-blur-params#${sourceEntity}`,
      size: MOTION_BLUR_PARAMS_BYTE_SIZE,
      usage: BufferUsage.UNIFORM | BufferUsage.COPY_DST,
    });
  cache.perCamera.set(sourceEntity, { texture, view, width, height, paramsBuffer });
  return { view, format: MOTION_BLUR_TARGET_FORMAT, width, height };
};

/**
 * Destroy and forget a camera's motion-blur resources. Called when the camera
 * leaves the live set or its prerequisites lapse.
 *
 * @internal
 */
export const evictMotionBlurTarget = (cache: ViewMotionBlurTargets, sourceEntity: Entity): void => {
  const entry = cache.perCamera.get(sourceEntity);
  if (entry === undefined) return;
  entry.view.destroy();
  entry.texture.destroy();
  entry.paramsBuffer.destroy();
  cache.perCamera.delete(sourceEntity);
};
