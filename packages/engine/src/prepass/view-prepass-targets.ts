import type { Entity } from '@retro-engine/ecs';
import type {
  ResolvedRenderTarget,
  Texture,
  TextureFormat,
  TextureView,
} from '@retro-engine/renderer-core';
import { TextureUsage } from '@retro-engine/renderer-core';

import type { App } from '../index';

import type { PrepassFlags } from './components';

/**
 * Depth format used by the screen-space prepass. Shared with the camera's
 * depth attachment (see `ViewDepthCache`) so the prepass writes the same
 * texture the opaque pass subsequently reads via `depthLoadOp: 'load'`.
 */
export const PREPASS_DEPTH_FORMAT: TextureFormat = 'depth32float';

/**
 * Color format for the screen-space normal target. Encodes the world-space
 * normal `N` in the `.rgb` channels (mapped from `[-1, 1]` to `[0, 1]`) and
 * perceptual roughness in `.a`. `rgba16float` is the simplest correct path:
 * no encode / decode round-trip, matches the HDR target's precision, and is
 * reachable on WebGL2 via `EXT_color_buffer_half_float`.
 *
 * Octahedral encoding into `rg16snorm` is a deferred optimization tracked in
 * ADR-0050's open questions.
 */
export const PREPASS_NORMAL_FORMAT: TextureFormat = 'rgba16float';

/**
 * Color format for the screen-space motion-vector target. Carries the
 * half-NDC delta `(prev - curr) * 0.5` per pixel. Two channels are enough —
 * the third / fourth would be wasted bandwidth — so the HAL exposes
 * `rg16float` and the prepass uses it directly.
 */
export const PREPASS_MOTION_VECTOR_FORMAT: TextureFormat = 'rg16float';

/**
 * Resolved view of a camera's prepass targets, exposed to render-graph nodes
 * that read or write the prepass attachments. `depth` is a borrowed pointer
 * to the camera's primary depth target (allocated by `ViewDepthCache`) and
 * must not be destroyed through this struct. `normal` and `motionVector`
 * are owned by `ViewPrepassTargets` and are present iff the camera has the
 * corresponding marker component.
 */
export interface ViewPrepassCameraTargets {
  readonly flags: PrepassFlags;
  readonly depth: ResolvedRenderTarget;
  readonly normal?: ResolvedRenderTarget;
  readonly motionVector?: ResolvedRenderTarget;
}

/**
 * Internal entry stored in {@link ViewPrepassTargets.perCamera}. Owns the
 * lifetimes of the normal and motion-vector textures; depth is borrowed.
 *
 * @internal
 */
export interface ViewPrepassCacheEntry {
  flags: PrepassFlags;
  depth: ResolvedRenderTarget;
  normalTex?: Texture;
  normalView?: TextureView;
  motionTex?: Texture;
  motionView?: TextureView;
  width: number;
  height: number;
}

/**
 * Per-camera screen-space prepass target cache, keyed by main-world camera
 * entity. Owns the normal + motion-vector textures; the depth attachment is
 * shared with `ViewDepthCache` (the same screen-space depth is written by
 * `PrepassNode3d` and subsequently read by `OpaquePass3dNode` via a `'load'`
 * depth op).
 *
 * Populated each frame in `RenderSet.Prepare` by `PrepassPlugin`'s prepare
 * system; entries are reallocated when the camera resizes or its prepass
 * flags change, and garbage-collected when a camera's `sourceEntity` is
 * absent from `SortedCameras.views`.
 *
 * Cameras with no prepass marker components — or with `depthTarget: 'none'`
 * — never receive an entry; `PrepassNode3d` and the prepass-read binding on
 * the opaque pipeline both check for the entry's presence and skip cleanly.
 */
export class ViewPrepassTargets {
  readonly perCamera: Map<Entity, ViewPrepassCacheEntry> = new Map();
}

/**
 * Allocate (or reuse) the per-camera color targets for a prepass-enabled
 * camera and write the resulting entry into {@link ViewPrepassTargets}.
 *
 * Resizing or flag-flipping destroys stale textures before allocating the
 * replacement set. Idempotent on a hit: returns the existing entry without
 * touching GPU resources.
 *
 * @internal Used by `PrepassPlugin`'s prepare system; not part of the
 *           public API.
 */
export const resolveCameraPrepassTargets = (
  cache: ViewPrepassTargets,
  app: App,
  sourceEntity: Entity,
  flags: PrepassFlags,
  depth: ResolvedRenderTarget,
): ViewPrepassCameraTargets => {
  const { width, height } = depth;
  const existing = cache.perCamera.get(sourceEntity);
  const flagsMatch =
    existing !== undefined &&
    existing.flags.depth === flags.depth &&
    existing.flags.normal === flags.normal &&
    existing.flags.motionVector === flags.motionVector &&
    existing.width === width &&
    existing.height === height;
  if (flagsMatch) {
    existing.depth = depth;
    return entryToView(existing);
  }
  if (existing !== undefined) destroyEntry(existing);

  const entry: ViewPrepassCacheEntry = {
    flags,
    depth,
    width,
    height,
  };
  if (flags.normal) {
    const tex = app.renderer.createTexture({
      label: `view-prepass-normal#${sourceEntity}`,
      width,
      height,
      format: PREPASS_NORMAL_FORMAT,
      usage: TextureUsage.RENDER_ATTACHMENT | TextureUsage.TEXTURE_BINDING,
    });
    entry.normalTex = tex;
    entry.normalView = tex.createView();
  }
  if (flags.motionVector) {
    const tex = app.renderer.createTexture({
      label: `view-prepass-motion#${sourceEntity}`,
      width,
      height,
      format: PREPASS_MOTION_VECTOR_FORMAT,
      usage: TextureUsage.RENDER_ATTACHMENT | TextureUsage.TEXTURE_BINDING,
    });
    entry.motionTex = tex;
    entry.motionView = tex.createView();
  }
  cache.perCamera.set(sourceEntity, entry);
  return entryToView(entry);
};

/**
 * Destroy and remove the entry for a camera. Called by the prepare system's
 * GC pass when a camera leaves the live set, and by
 * {@link resolveCameraPrepassTargets} when the entry needs to be rebuilt.
 *
 * @internal
 */
export const evictCameraPrepassTargets = (
  cache: ViewPrepassTargets,
  sourceEntity: Entity,
): void => {
  const entry = cache.perCamera.get(sourceEntity);
  if (entry === undefined) return;
  destroyEntry(entry);
  cache.perCamera.delete(sourceEntity);
};

const destroyEntry = (entry: ViewPrepassCacheEntry): void => {
  if (entry.normalView !== undefined) entry.normalView.destroy();
  if (entry.normalTex !== undefined) entry.normalTex.destroy();
  if (entry.motionView !== undefined) entry.motionView.destroy();
  if (entry.motionTex !== undefined) entry.motionTex.destroy();
};

const entryToView = (entry: ViewPrepassCacheEntry): ViewPrepassCameraTargets => {
  const { width, height } = entry;
  const view: { -readonly [K in keyof ViewPrepassCameraTargets]: ViewPrepassCameraTargets[K] } = {
    flags: entry.flags,
    depth: entry.depth,
  };
  if (entry.normalView !== undefined) {
    view.normal = {
      view: entry.normalView,
      format: PREPASS_NORMAL_FORMAT,
      width,
      height,
    };
  }
  if (entry.motionView !== undefined) {
    view.motionVector = {
      view: entry.motionView,
      format: PREPASS_MOTION_VECTOR_FORMAT,
      width,
      height,
    };
  }
  return view as ViewPrepassCameraTargets;
};
