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
 * Format of the per-camera TAA history / output intermediates. Matches the HDR
 * intermediate (`rgba16float`) so the resolve accumulates and hands off the
 * scene at the same precision the rest of the post chain works in.
 */
export const TAA_TARGET_FORMAT: TextureFormat = 'rgba16float';

/** Byte size of the TAA params uniform: `blend:f32`, `reset:u32`, pad, pad. */
export const TAA_PARAMS_BYTE_SIZE = 16 as const;

/**
 * Per-camera GPU resources for the TAA resolve: a two-texture ping-pong of the
 * resolved color plus the params uniform buffer. Each frame the resolve writes
 * slot {@link current} and reads the other slot as history, then {@link current}
 * flips — so the texture just written becomes next frame's history. Owns both
 * textures; do not destroy the views elsewhere.
 *
 * @internal
 */
export interface TaaCacheEntry {
  textures: readonly [Texture, Texture];
  views: readonly [TextureView, TextureView];
  width: number;
  height: number;
  paramsBuffer: Buffer;
  /** Index of the slot the resolve writes this frame; `current ^ 1` is history. */
  current: 0 | 1;
  /**
   * `false` until a resolved frame exists in the slot next frame will read —
   * cleared on (re)allocation so the first frame after a resize re-primes from
   * the current scene instead of blending stale or empty history.
   */
  valid: boolean;
}

/**
 * Render-world resource caching each TAA camera's history ping-pong and params
 * buffer across frames, keyed by main-world camera `sourceEntity`. Allocated /
 * reused / evicted by `TaaPlugin`'s prepare system.
 *
 * @internal
 */
export class ViewTaaTargets {
  readonly perCamera: Map<Entity, TaaCacheEntry> = new Map();
}

/**
 * Allocate (or reuse) the TAA history ping-pong and params buffer for a camera,
 * sized to `color`. Reallocates both textures on a size change (clearing
 * `valid` so history re-primes); the params buffer is created once and reused.
 * Returns the cache entry.
 *
 * @internal
 */
export const resolveTaaTargets = (
  cache: ViewTaaTargets,
  app: App,
  sourceEntity: Entity,
  color: ResolvedRenderTarget,
): TaaCacheEntry => {
  const { width, height } = color;
  const existing = cache.perCamera.get(sourceEntity);
  if (existing !== undefined && existing.width === width && existing.height === height) {
    return existing;
  }
  if (existing !== undefined) {
    existing.views[0].destroy();
    existing.views[1].destroy();
    existing.textures[0].destroy();
    existing.textures[1].destroy();
  }
  const make = (slot: number): { texture: Texture; view: TextureView } => {
    const texture = app.renderer.createTexture({
      label: `view-taa#${sourceEntity}.${slot}`,
      width,
      height,
      format: TAA_TARGET_FORMAT,
      usage: TextureUsage.RENDER_ATTACHMENT | TextureUsage.TEXTURE_BINDING,
    });
    return { texture, view: texture.createView() };
  };
  const a = make(0);
  const b = make(1);
  const paramsBuffer =
    existing?.paramsBuffer ??
    app.renderer.createBuffer({
      label: `view-taa-params#${sourceEntity}`,
      size: TAA_PARAMS_BYTE_SIZE,
      usage: BufferUsage.UNIFORM | BufferUsage.COPY_DST,
    });
  const entry: TaaCacheEntry = {
    textures: [a.texture, b.texture],
    views: [a.view, b.view],
    width,
    height,
    paramsBuffer,
    current: 0,
    valid: false,
  };
  cache.perCamera.set(sourceEntity, entry);
  return entry;
};

/**
 * Destroy and forget a camera's TAA resources. Called when the camera leaves
 * the live set or its prerequisites lapse.
 *
 * @internal
 */
export const evictTaaTargets = (cache: ViewTaaTargets, sourceEntity: Entity): void => {
  const entry = cache.perCamera.get(sourceEntity);
  if (entry === undefined) return;
  entry.views[0].destroy();
  entry.views[1].destroy();
  entry.textures[0].destroy();
  entry.textures[1].destroy();
  entry.paramsBuffer.destroy();
  cache.perCamera.delete(sourceEntity);
};
