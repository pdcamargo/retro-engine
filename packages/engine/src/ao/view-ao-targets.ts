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
 * Format of the ambient-occlusion target. A single-channel `r8unorm` is enough
 * for a `[0, 1]` visibility factor, is filterable (so the forward shader can
 * bilinearly sample it), and is reachable on WebGL2.
 */
export const AO_TARGET_FORMAT: TextureFormat = 'r8unorm';

/**
 * Format of the temporal AO history ping-pong: `rg16float` carries the
 * accumulated occlusion in `.r` and the view-space linear depth it was computed
 * at in `.g` (used to reject reprojected history on disocclusion).
 */
export const AO_HISTORY_FORMAT: TextureFormat = 'rg16float';

/**
 * Byte size of the AO params uniform. Layout (std140, 16-byte aligned):
 * `inv_proj: mat4x4` (0), `view: mat4x4` (64), `resolution: vec2` (128),
 * `inv_resolution: vec2` (136), `radius` (144), `intensity` (148), `bias` (152),
 * `focal_y` (156), `slices` (160), `steps` (164), `frame_index` (168), pad (172).
 */
export const AO_PARAMS_BYTE_SIZE = 176 as const;

/**
 * Per-camera GPU resources for the AO pass: the sampleable single-channel
 * output the GTAO pass writes (and the opaque shader samples) plus the params
 * uniform buffer. Owns the texture; do not destroy the view elsewhere.
 *
 * `finalView` is the texture the opaque pass samples at `@group(3)`: the
 * denoised AO. The GTAO pass writes `raw`; the bilateral blur reads `raw` and
 * writes `blurred`, which `finalView` points at. Repointing `finalView` lets a
 * later temporal stage slot in without changing the opaque-pass wiring.
 *
 * @internal
 */
export interface AoCacheEntry {
  rawTexture: Texture;
  rawView: TextureView;
  blurredTexture: Texture;
  blurredView: TextureView;
  finalView: TextureView;
  width: number;
  height: number;
  paramsBuffer: Buffer;
  /**
   * Temporal history ping-pong (`rg16float`), present only while the camera has
   * a motion-vector prepass (temporal accumulation enabled). The temporal pass
   * reads slot `current ^ 1` and writes slot `current`; the written slot becomes
   * next frame's history and is what `finalView` points at.
   */
  historyTextures: readonly [Texture, Texture] | undefined;
  historyViews: readonly [TextureView, TextureView] | undefined;
  /** Slot the temporal pass writes this frame. Flipped each frame by the plugin. */
  current: 0 | 1;
  /** False until a temporal frame has accumulated (first frame / post-resize re-prime). */
  historyValid: boolean;
}

/**
 * Render-world resource caching each AO camera's output target and params
 * buffer across frames, keyed by main-world camera `sourceEntity`. Allocated /
 * reused / evicted by `AoPlugin`'s prepare system.
 *
 * @internal
 */
export class ViewAoTargets {
  readonly perCamera: Map<Entity, AoCacheEntry> = new Map();
}

/**
 * Allocate (or reuse) the AO output target and params buffer for a camera,
 * sized to `color`. Reallocates the texture on a size change; the params buffer
 * is created once and reused. Returns the cache entry.
 *
 * @internal
 */
export const resolveAoTargets = (
  cache: ViewAoTargets,
  app: App,
  sourceEntity: Entity,
  color: ResolvedRenderTarget,
  temporal: boolean,
): AoCacheEntry => {
  const { width, height } = color;
  const make = (suffix: string, format: TextureFormat): { texture: Texture; view: TextureView } => {
    const texture = app.renderer.createTexture({
      label: `view-ao-${suffix}#${sourceEntity}`,
      width,
      height,
      format,
      usage: TextureUsage.RENDER_ATTACHMENT | TextureUsage.TEXTURE_BINDING,
    });
    return { texture, view: texture.createView() };
  };

  let entry = cache.perCamera.get(sourceEntity);
  if (entry === undefined || entry.width !== width || entry.height !== height) {
    if (entry !== undefined) {
      entry.rawView.destroy();
      entry.rawTexture.destroy();
      entry.blurredView.destroy();
      entry.blurredTexture.destroy();
      destroyHistory(entry);
    }
    const raw = make('raw', AO_TARGET_FORMAT);
    const blurred = make('blur', AO_TARGET_FORMAT);
    const paramsBuffer =
      entry?.paramsBuffer ??
      app.renderer.createBuffer({
        label: `view-ao-params#${sourceEntity}`,
        size: AO_PARAMS_BYTE_SIZE,
        usage: BufferUsage.UNIFORM | BufferUsage.COPY_DST,
      });
    entry = {
      rawTexture: raw.texture,
      rawView: raw.view,
      blurredTexture: blurred.texture,
      blurredView: blurred.view,
      finalView: blurred.view,
      width,
      height,
      paramsBuffer,
      historyTextures: undefined,
      historyViews: undefined,
      current: 0,
      historyValid: false,
    };
    cache.perCamera.set(sourceEntity, entry);
  }

  // Reconcile the history pair with the temporal flag (motion-vector presence).
  if (temporal && entry.historyTextures === undefined) {
    const a = make('hist0', AO_HISTORY_FORMAT);
    const b = make('hist1', AO_HISTORY_FORMAT);
    entry.historyTextures = [a.texture, b.texture];
    entry.historyViews = [a.view, b.view];
    entry.historyValid = false;
  } else if (!temporal && entry.historyTextures !== undefined) {
    destroyHistory(entry);
    entry.historyTextures = undefined;
    entry.historyViews = undefined;
    entry.finalView = entry.blurredView;
  }
  return entry;
};

const destroyHistory = (entry: AoCacheEntry): void => {
  if (entry.historyViews !== undefined) {
    entry.historyViews[0].destroy();
    entry.historyViews[1].destroy();
  }
  if (entry.historyTextures !== undefined) {
    entry.historyTextures[0].destroy();
    entry.historyTextures[1].destroy();
  }
};

/**
 * Destroy and forget a camera's AO resources. Called when the camera leaves the
 * live set or its prerequisites lapse.
 *
 * @internal
 */
export const evictAoTargets = (cache: ViewAoTargets, sourceEntity: Entity): void => {
  const entry = cache.perCamera.get(sourceEntity);
  if (entry === undefined) return;
  entry.rawView.destroy();
  entry.rawTexture.destroy();
  entry.blurredView.destroy();
  entry.blurredTexture.destroy();
  destroyHistory(entry);
  entry.paramsBuffer.destroy();
  cache.perCamera.delete(sourceEntity);
};
