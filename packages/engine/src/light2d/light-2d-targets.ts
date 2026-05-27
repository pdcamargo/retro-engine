import type { Entity } from '@retro-engine/ecs';
import type { BindGroup, Texture, TextureFormat, TextureView } from '@retro-engine/renderer-core';
import { TextureUsage } from '@retro-engine/renderer-core';

import { Core2dLabel } from '../render-graph/core-2d';
import { SortedCameras } from '../camera/sorted-cameras';
import type { App } from '../index';

import { LIGHT2D_NORMAL_FORMAT, Light2dNormalState } from './light-2d-normal';
import type { Light2dPipeline } from './light-2d-pipeline';

/**
 * One camera's worth of 2D-lighting GPU state — the two intermediate textures
 * the lighting pipeline writes into (`baseColor` for the geometry passes,
 * `lightAccum` for the additive light accumulation) plus the composite-pass
 * bind group that samples both. Cached across frames in
 * {@link ViewLight2dTargets} keyed by the main-world camera entity.
 *
 * Texture identities change whenever the camera's color-target dimensions or
 * format change; the composite bind group is rebuilt at the same time
 * because its bound views are no longer valid.
 *
 * @internal
 */
export interface Light2dCameraTargets {
  baseColorTex: Texture;
  baseColorView: TextureView;
  baseColorFormat: TextureFormat;
  lightAccumTex: Texture;
  lightAccumView: TextureView;
  /** Per-camera normal G-buffer the normal prepass writes and accumulation samples for `N·L`. */
  normalTex: Texture;
  normalView: TextureView;
  width: number;
  height: number;
  compositeBindGroup: BindGroup;
  /** `@group(2)` for accumulation: normal view + sampler + `(enabled, height)` uniform. */
  normalAccumBindGroup: BindGroup;
}

/**
 * Per-camera 2D-lighting texture cache, mirroring the lifecycle pattern of
 * `ViewDepthCache` from `CameraPlugin` — keyed by the stable main-world
 * camera `sourceEntity`, populated in `RenderSet.Prepare` by
 * {@link prepareLight2dTargets}, and garbage-collected when the camera
 * disappears from `SortedCameras.views`.
 *
 * The presence of an entry for a given camera entity is what tells the Core2d
 * phase nodes to redirect their color attachment from `view.target.view` to
 * the camera's `baseColorView`; the absence of an entry (no `Light2dPlugin`
 * installed, or the camera isn't a Core2d camera) restores the unlit code
 * path with zero behavior change.
 *
 * @internal
 */
export class ViewLight2dTargets {
  readonly perCamera: Map<Entity, Light2dCameraTargets> = new Map();
}

const destroyEntry = (entry: Light2dCameraTargets): void => {
  entry.compositeBindGroup.destroy();
  entry.normalAccumBindGroup.destroy();
  entry.baseColorView.destroy();
  entry.baseColorTex.destroy();
  entry.lightAccumView.destroy();
  entry.lightAccumTex.destroy();
  entry.normalView.destroy();
  entry.normalTex.destroy();
};

/**
 * `RenderSet.Prepare` system. For every active Core2d camera, allocate (or
 * reuse) a baseColor texture matching the camera's color-target format and
 * a `Rgba16Float` lightAccum texture matching its dimensions, plus the
 * composite-pass bind group that samples both. Entries whose camera has
 * disappeared since last frame are destroyed and removed from the cache.
 *
 * The first frame after plugin build may bail before allocating anything:
 * {@link Light2dPipeline.ensureInitialised} returns `false` until the camera
 * plugin's view bind-group layout exists (which lands on the first frame's
 * `prepareCameras`). On that first frame the cache stays empty, the
 * Core2d nodes fall back to direct surface writes, and lighting kicks in
 * one frame later. This mirrors how `SpritePipeline` handles the same race.
 *
 * @internal
 */
export const prepareLight2dTargets = (
  app: App,
  sorted: SortedCameras,
  targets: ViewLight2dTargets,
  pipeline: Light2dPipeline,
): void => {
  const ready = pipeline.ensureInitialised(app);
  if (!ready) {
    // Pipeline not ready yet (no view layout). Drop any stale cache entries
    // so we don't leave dangling textures referencing the previous frame's
    // pipeline state.
    for (const [entity, entry] of targets.perCamera) {
      destroyEntry(entry);
      targets.perCamera.delete(entity);
    }
    return;
  }

  const live = new Set<Entity>();
  for (const view of sorted.views) {
    if (view.subGraph !== Core2dLabel) continue;
    const sourceEntity = view.sourceEntity as Entity;
    live.add(sourceEntity);

    const { width, height, format } = view.target;
    const existing = targets.perCamera.get(sourceEntity);
    if (
      existing !== undefined &&
      existing.width === width &&
      existing.height === height &&
      existing.baseColorFormat === format
    ) {
      continue;
    }
    if (existing !== undefined) destroyEntry(existing);

    const baseColorTex = app.renderer.createTexture({
      label: `light2d-base-color#${sourceEntity}`,
      width,
      height,
      format,
      usage: TextureUsage.RENDER_ATTACHMENT | TextureUsage.TEXTURE_BINDING,
    });
    const baseColorView = baseColorTex.createView();
    const lightAccumTex = app.renderer.createTexture({
      label: `light2d-light-accum#${sourceEntity}`,
      width,
      height,
      format: 'rgba16float',
      usage: TextureUsage.RENDER_ATTACHMENT | TextureUsage.TEXTURE_BINDING,
    });
    const lightAccumView = lightAccumTex.createView();
    const compositeBindGroup = pipeline.buildCompositeBindGroup(
      app,
      sourceEntity,
      baseColorView,
      lightAccumView,
    );

    const normalState = app.getResource(Light2dNormalState);
    normalState?.ensureResources(app);
    const normalTex = app.renderer.createTexture({
      label: `light2d-normal#${sourceEntity}`,
      width,
      height,
      format: LIGHT2D_NORMAL_FORMAT,
      usage: TextureUsage.RENDER_ATTACHMENT | TextureUsage.TEXTURE_BINDING,
    });
    const normalView = normalTex.createView();
    const normalAccumBindGroup = pipeline.buildNormalAccumBindGroup(
      app,
      sourceEntity,
      normalView,
      normalState!.sampler!,
      normalState!.uniformBuffer!,
    );

    targets.perCamera.set(sourceEntity, {
      baseColorTex,
      baseColorView,
      baseColorFormat: format,
      lightAccumTex,
      lightAccumView,
      normalTex,
      normalView,
      width,
      height,
      compositeBindGroup,
      normalAccumBindGroup,
    });
  }

  for (const [entity, entry] of targets.perCamera) {
    if (!live.has(entity)) {
      destroyEntry(entry);
      targets.perCamera.delete(entity);
    }
  }
};
