import type { Entity } from '@retro-engine/ecs';
import { mat4, vec3 } from '@retro-engine/math';
import { t, type FieldType } from '@retro-engine/reflect';
import type { ResolvedRenderTarget } from '@retro-engine/renderer-core';
import { BufferUsage, ShaderStage, TextureUsage } from '@retro-engine/renderer-core';

import type { App } from '../index';
import type { Logger } from '../log';
import type { PluginObject } from '../plugin';
import { RenderSet } from '../render-set';
import { Extract, Query, Res, ResMut } from '../system-param';
import { GlobalTransform } from '../transform';
import {
  Camera,
  type CameraDepthTarget,
  type CameraRenderTarget,
  type CameraView,
  ClearColorConfig,
  type Viewport,
} from './camera';
import { ClearColor } from './clear-color';
import { CurrentHdrView } from './current-hdr-view';
import { jitterProjection, ViewJitter } from './jitter';
import { MainCamera } from './main-camera';
import { ShaderRegistry } from '../shader/shader-registry';
import {
  ExtractedCamera,
  HDR_TARGET_FORMAT,
  readAndAdvancePrevViewProj,
  VIEW_UNIFORM_BYTE_SIZE,
  VIEW_UNIFORM_WGSL,
  ViewBindGroupCache,
  ViewDepthCache,
  ViewHdrTargets,
  ViewPreviousFrame,
} from './extracted';
import {
  buildOrthographicMatrix,
  buildPerspectiveMatrix,
  OrthographicProjection,
  PerspectiveProjection,
  updateOrthographicArea,
} from './projection';
import type { RenderLabel } from '../render-graph/render-label';
import { RenderLayers } from './render-layers';
import { SortedCameras } from './sorted-cameras';

const targetKindOf = (target: CameraRenderTarget): 'primary' | 'surface' | 'texture' | 'view' =>
  target.kind;

const resolveTargetSize = (
  target: CameraRenderTarget,
  app: App,
): { width: number; height: number } | undefined => {
  switch (target.kind) {
    case 'primary': {
      const s = app.getSurface();
      return s ? { width: s.width, height: s.height } : undefined;
    }
    case 'surface':
      return { width: target.surface.width, height: target.surface.height };
    case 'texture':
      return { width: target.texture.width, height: target.texture.height };
    case 'view':
      return { width: target.width, height: target.height };
  }
};

const resolveCameraRenderTarget = (
  target: CameraRenderTarget,
  app: App,
): ResolvedRenderTarget | undefined => {
  switch (target.kind) {
    case 'primary': {
      const surface = app.getSurface();
      if (!surface) return undefined;
      return app.renderer.resolveRenderTarget({ kind: 'surface', surface });
    }
    case 'surface':
      return app.renderer.resolveRenderTarget({ kind: 'surface', surface: target.surface });
    case 'texture':
      return app.renderer.resolveRenderTarget(
        target.viewDescriptor !== undefined
          ? { kind: 'texture', texture: target.texture, viewDescriptor: target.viewDescriptor }
          : { kind: 'texture', texture: target.texture },
      );
    case 'view':
      return app.renderer.resolveRenderTarget({
        kind: 'view',
        view: target.view,
        format: target.format,
        width: target.width,
        height: target.height,
      });
  }
};

const ensureViewLayout = (cache: ViewBindGroupCache, app: App): void => {
  if (cache.layout !== undefined) return;
  cache.layout = app.renderer.createBindGroupLayout({
    label: 'view',
    entries: [
      {
        binding: 0,
        visibility: ShaderStage.VERTEX | ShaderStage.FRAGMENT,
        buffer: { type: 'uniform' },
      },
    ],
  });
};

const ensureCameraSlots = (cache: ViewBindGroupCache, app: App, sourceEntity: Entity) => {
  let slots = cache.perCamera.get(sourceEntity);
  if (slots) return slots;
  ensureViewLayout(cache, app);
  const buffer = app.renderer.createBuffer({
    label: `view#${sourceEntity}`,
    size: VIEW_UNIFORM_BYTE_SIZE,
    usage: BufferUsage.UNIFORM | BufferUsage.COPY_DST,
  });
  const bindGroup = app.renderer.createBindGroup({
    label: `view#${sourceEntity}`,
    layout: cache.layout!,
    entries: [{ binding: 0, resource: { buffer } }],
  });
  slots = { buffer, bindGroup };
  cache.perCamera.set(sourceEntity, slots);
  return slots;
};

const writeViewUniform = (
  scratch: Float32Array,
  viewProj: Float32Array,
  view: Float32Array,
  inverseView: Float32Array,
  projection: Float32Array,
  worldPosition: Float32Array,
  viewport: Viewport,
  prevViewProj: Float32Array,
  unjitteredViewProj: Float32Array,
): void => {
  scratch.set(viewProj, 0);
  scratch.set(view, 16);
  scratch.set(inverseView, 32);
  scratch.set(projection, 48);
  scratch[64] = worldPosition[0]!;
  scratch[65] = worldPosition[1]!;
  scratch[66] = worldPosition[2]!;
  scratch[67] = 0;
  scratch[68] = viewport.physicalPosition.x;
  scratch[69] = viewport.physicalPosition.y;
  scratch[70] = viewport.physicalSize.width;
  scratch[71] = viewport.physicalSize.height;
  scratch.set(prevViewProj, 72);
  scratch.set(unjitteredViewProj, 88);
};

const fullTargetViewport = (target: ResolvedRenderTarget): Viewport => ({
  physicalPosition: { x: 0, y: 0 },
  physicalSize: { width: target.width, height: target.height },
  depth: { min: 0, max: 1 },
});

/**
 * Resolve a {@link CameraDepthTarget} to a concrete `(view, format)` pair,
 * allocating or reusing a depth texture in {@link ViewDepthCache} for the
 * `'auto'` case. Returns `undefined` for `'none'` cameras.
 *
 * Reallocates when the cached texture's dimensions or format no longer match
 * the camera's color-target size + requested depth format.
 */
/**
 * When `hdr` is true, allocate (or reuse) a per-camera `rgba16float`
 * intermediate texture sized to the camera's color target and return a
 * `ResolvedRenderTarget` view of it. When `hdr` is false, drop any existing
 * entry for this camera and return `undefined` — callers fall back to
 * `view.target` for the main color attachment.
 *
 * Mirrors {@link resolveCameraDepth} exactly: reallocates on size change,
 * destroys-and-reinserts on format-flag flip, no-ops on a hit.
 */
const resolveCameraHdrTarget = (
  cache: ViewHdrTargets,
  app: App,
  sourceEntity: Entity,
  hdr: boolean,
  color: ResolvedRenderTarget,
): ResolvedRenderTarget | undefined => {
  if (!hdr) {
    const existing = cache.perCamera.get(sourceEntity);
    if (existing) {
      existing.view.destroy();
      existing.texture.destroy();
      cache.perCamera.delete(sourceEntity);
    }
    return undefined;
  }
  const { width, height } = color;
  const existing = cache.perCamera.get(sourceEntity);
  if (
    existing &&
    existing.width === width &&
    existing.height === height &&
    existing.format === HDR_TARGET_FORMAT
  ) {
    return { view: existing.view, format: existing.format, width, height };
  }
  if (existing) {
    existing.view.destroy();
    existing.texture.destroy();
  }
  const texture = app.renderer.createTexture({
    label: `view-hdr#${sourceEntity}`,
    width,
    height,
    format: HDR_TARGET_FORMAT,
    usage: TextureUsage.RENDER_ATTACHMENT | TextureUsage.TEXTURE_BINDING,
  });
  const view = texture.createView();
  cache.perCamera.set(sourceEntity, {
    texture,
    view,
    width,
    height,
    format: HDR_TARGET_FORMAT,
  });
  return { view, format: HDR_TARGET_FORMAT, width, height };
};

const resolveCameraDepth = (
  cache: ViewDepthCache,
  app: App,
  sourceEntity: Entity,
  depthTarget: CameraDepthTarget,
  color: ResolvedRenderTarget,
): { view: import('@retro-engine/renderer-core').TextureView; format: import('@retro-engine/renderer-core').TextureFormat } | undefined => {
  if (depthTarget.kind === 'none') {
    const existing = cache.perCamera.get(sourceEntity);
    if (existing) {
      existing.view.destroy();
      existing.texture.destroy();
      cache.perCamera.delete(sourceEntity);
    }
    return undefined;
  }
  if (depthTarget.kind === 'manual') {
    const existing = cache.perCamera.get(sourceEntity);
    if (existing) {
      existing.view.destroy();
      existing.texture.destroy();
      cache.perCamera.delete(sourceEntity);
    }
    return { view: depthTarget.view, format: depthTarget.format };
  }
  // 'auto'
  const format = depthTarget.format ?? 'depth32float';
  const { width, height } = color;
  const existing = cache.perCamera.get(sourceEntity);
  if (
    existing &&
    existing.width === width &&
    existing.height === height &&
    existing.format === format
  ) {
    return { view: existing.view, format };
  }
  if (existing) {
    existing.view.destroy();
    existing.texture.destroy();
  }
  const texture = app.renderer.createTexture({
    label: `view-depth#${sourceEntity}`,
    width,
    height,
    format,
    // TEXTURE_BINDING so screen-space passes (ambient occlusion, and future
    // depth-driven effects) can sample the depth the geometry passes wrote.
    // Additive: the depth attachment usage is unchanged; sampleability costs
    // no extra memory and is reachable on WebGL2 for depth formats.
    usage: TextureUsage.RENDER_ATTACHMENT | TextureUsage.TEXTURE_BINDING,
  });
  const view = texture.createView();
  cache.perCamera.set(sourceEntity, { texture, view, width, height, format });
  return { view, format };
};

const resolveClearColor = (config: ClearColorConfig, fallback: ClearColor) => {
  if (config.kind === 'none') return { color: undefined, loadOp: 'load' as const };
  const color = config.kind === 'custom' ? config.color : fallback.color;
  return { color, loadOp: 'clear' as const };
};

const isOffscreen = (kind: 'primary' | 'surface' | 'texture' | 'view') =>
  kind === 'texture' || kind === 'view';

interface SortableCameraView extends CameraView {
  readonly _targetKind: 'primary' | 'surface' | 'texture' | 'view';
}

/**
 * Framework plugin owning the camera lifecycle: builds `Camera.computed`
 * in `'postUpdate'`, extracts active cameras into the render world in
 * `RenderSet.Extract`, and prepares per-camera view uniforms and bind groups
 * in `RenderSet.Prepare`. The resulting {@link SortedCameras} resource drives
 * the per-camera dispatch loop in `App.renderFrame()`.
 *
 * `CorePlugin` registers this automatically. Re-adding it manually throws
 * (it's unique).
 */
export class CameraPlugin implements PluginObject {
  name(): string {
    return 'CameraPlugin';
  }

  build(app: App): void {
    if (app.getResource(ClearColor) === undefined) {
      app.insertResource(new ClearColor());
    }
    app.insertResource(new SortedCameras());
    app.insertResource(new ViewBindGroupCache());
    app.insertResource(new ViewDepthCache());
    app.insertResource(new ViewHdrTargets());
    app.insertResource(new ViewPreviousFrame());
    app.insertResource(new ViewJitter());
    app.insertResource(new CurrentHdrView());

    // ClearColor is authored world state, not a component — it registers as a
    // resource so it rides a saved scene's `resources`.
    app.registerResource(ClearColor, { color: t.color }, { name: 'ClearColor' });

    // Reflection schemas. `target` and `depthTarget` register only their data
    // arms — the surface/texture/view/manual arms carry live GPU references with
    // no persistent identity, so a camera holding one round-trips back to its
    // default arm. `computed` is rebuilt each frame from the projection + GlobalTransform.
    app.registerComponent(
      Camera,
      {
        isActive: t.boolean,
        order: t.number,
        hdr: t.boolean,
        msaaWriteback: t.boolean,
        viewport: t
          .struct({
            physicalPosition: t.struct({ x: t.number, y: t.number }),
            physicalSize: t.struct({ width: t.number, height: t.number }),
            depth: t.struct({ min: t.number, max: t.number }),
          })
          .optional(),
        clearColor: t.variant('kind', { default: {}, none: {}, custom: { color: t.color } }),
        target: t.variant('kind', { primary: {} }),
        depthTarget: t.variant('kind', { auto: {}, none: {} }),
        // RenderLabel is a branded string; the brand is phantom, so a plain string round-trips it.
        subGraph: t.string as FieldType<RenderLabel>,
        computed: t
          .struct({
            targetSize: t.struct({ width: t.number, height: t.number }),
            viewMatrix: t.mat4,
            projectionMatrix: t.mat4,
            viewProjectionMatrix: t.mat4,
            worldPosition: t.vec3,
          })
          .skip(),
      },
      { name: 'Camera' },
    );
    app.registerComponent(
      PerspectiveProjection,
      { fov: t.number, near: t.number, far: t.number, aspectRatio: t.number.skip() },
      { name: 'PerspectiveProjection' },
    );
    app.registerComponent(
      OrthographicProjection,
      {
        near: t.number,
        far: t.number,
        viewportOrigin: t.struct({ x: t.number, y: t.number }),
        scalingMode: t.variant('kind', {
          windowSize: {},
          fixed: { width: t.number, height: t.number },
          autoMin: { minWidth: t.number, minHeight: t.number },
          autoMax: { maxWidth: t.number, maxHeight: t.number },
          fixedVertical: { viewportHeight: t.number },
          fixedHorizontal: { viewportWidth: t.number },
        }),
        scale: t.number,
        area: t
          .struct({ minX: t.number, minY: t.number, maxX: t.number, maxY: t.number })
          .skip(),
      },
      { name: 'OrthographicProjection' },
    );
    app.registerComponent(
      RenderLayers,
      { mask: t.number },
      { name: 'RenderLayers', make: () => new RenderLayers() },
    );
    // Pure marker designating the primary game camera; no fields to persist.
    app.registerComponent(MainCamera, {}, { name: 'MainCamera' });

    // Register the canonical view uniform module so user shaders can write
    // `#import retro_engine::view` to pull in the ViewUniform struct + the
    // @group(0)/@binding(0) declaration that ADR-0020 reserves for view data.
    // ShaderPlugin runs immediately before us under CorePlugin, so the
    // registry is guaranteed present.
    app.getResource(ShaderRegistry)?.register('retro_engine::view', VIEW_UNIFORM_WGSL);

    const log: Logger = app.logger.child('camera');
    const warnedMissingPrimary = { value: false };

    // postUpdate: refresh Camera.computed for every active camera against the
    // main world's GlobalTransform + projection components. Two queries cover
    // the perspective/orthographic split.
    app.addSystem(
      'postUpdate',
      [
        Query([Camera, GlobalTransform, PerspectiveProjection]),
        Query([Camera, GlobalTransform, OrthographicProjection]),
      ],
      (perspectives, orthos) => {
        for (const [camera, gt, proj] of perspectives) {
          if (!camera.isActive) continue;
          const size = resolveTargetSize(camera.target, app);
          if (!size) continue;
          const c = camera.computed;
          c.targetSize.width = size.width;
          c.targetSize.height = size.height;
          proj.aspectRatio = size.height > 0 ? size.width / size.height : 1;
          buildPerspectiveMatrix(c.projectionMatrix, proj);
          mat4.invert(gt.matrix, c.viewMatrix);
          mat4.multiply(c.projectionMatrix, c.viewMatrix, c.viewProjectionMatrix);
          mat4.getTranslation(gt.matrix, c.worldPosition);
        }
        for (const [camera, gt, proj] of orthos) {
          if (!camera.isActive) continue;
          const size = resolveTargetSize(camera.target, app);
          if (!size) continue;
          const c = camera.computed;
          c.targetSize.width = size.width;
          c.targetSize.height = size.height;
          updateOrthographicArea(proj, size.width, size.height);
          buildOrthographicMatrix(c.projectionMatrix, proj);
          mat4.invert(gt.matrix, c.viewMatrix);
          mat4.multiply(c.projectionMatrix, c.viewMatrix, c.viewProjectionMatrix);
          mat4.getTranslation(gt.matrix, c.worldPosition);
        }
      },
      { name: 'camera-update-computed' },
    );

    // RenderSet.Extract: clone active main-world cameras into render-world
    // entities for the rest of the render schedule to consume. Render world
    // clears each frame, so we always start from zero.
    app.addSystem(
      'render',
      [Extract(Query([Camera, GlobalTransform]))],
      (q) => {
        for (const [entity, camera, _gt] of q.entries()) {
          if (!camera.isActive) continue;
          // Skip cameras whose target the engine cannot read a size for —
          // they would render to nothing this frame (e.g. `primary` on a
          // headless App, or a target whose backing is gone).
          const size = resolveTargetSize(camera.target, app);
          if (!size) continue;
          const layers = app.world.getComponent(entity, RenderLayers);
          const c = camera.computed;
          app.renderWorld.spawn(
            new ExtractedCamera({
              sourceEntity: entity,
              order: camera.order,
              target: camera.target,
              depthTarget: camera.depthTarget,
              viewport: camera.viewport,
              clearColor: camera.clearColor,
              hdr: camera.hdr,
              renderLayers: layers?.mask ?? RenderLayers.DEFAULT_MASK,
              viewMatrix: mat4.clone(c.viewMatrix),
              projectionMatrix: mat4.clone(c.projectionMatrix),
              viewProjectionMatrix: mat4.clone(c.viewProjectionMatrix),
              worldPosition: vec3.clone(c.worldPosition),
              targetSize: { width: size.width, height: size.height },
              subGraph: camera.subGraph,
            }),
          );
        }
      },
      { set: RenderSet.Extract, name: 'camera-extract' },
    );

    // RenderSet.Prepare: resolve each extracted camera's target, allocate
    // or reuse its view bind group, upload the view uniform, and populate
    // SortedCameras with the per-frame CameraView entries in dispatch order.
    app.addSystem(
      'render',
      [
        Query([ExtractedCamera]),
        ResMut(ViewBindGroupCache),
        ResMut(ViewDepthCache),
        ResMut(ViewHdrTargets),
        ResMut(ViewPreviousFrame),
        ResMut(SortedCameras),
        Res(ClearColor),
        Res(ViewJitter),
        ResMut(CurrentHdrView),
      ],
      (q, cache, depthCache, hdrCache, prevFrame, sorted, clearColor, jitter, currentHdr) => {
        sorted.views.length = 0;
        // Reseed the post-process chain handoff each frame; HDR cameras start
        // it at their scene intermediate, non-HDR cameras get no entry.
        currentHdr.perCamera.clear();
        const sortable: SortableCameraView[] = [];
        const inverseViewScratch = mat4.identity();
        // Reused per camera to bake sub-pixel jitter into `view_proj` without
        // disturbing the unjittered matrix the motion-vector prepass reads.
        const jitteredProjScratch = mat4.create();
        const jitteredViewProjScratch = mat4.create();
        const liveSourceEntities = new Set<Entity>();
        for (const [renderEntity, ext] of q.entries()) {
          const resolved = resolveCameraRenderTarget(ext.target, app);
          if (!resolved) {
            if (ext.target.kind === 'primary' && !warnedMissingPrimary.value) {
              log.devWarn(
                `camera (source entity ${ext.sourceEntity}) targets the primary surface but the App has no surface — skipping`,
              );
              warnedMissingPrimary.value = true;
            }
            continue;
          }
          liveSourceEntities.add(ext.sourceEntity);
          const slots = ensureCameraSlots(cache, app, ext.sourceEntity);
          const depth = resolveCameraDepth(
            depthCache,
            app,
            ext.sourceEntity,
            ext.depthTarget,
            resolved,
          );
          const hdrTarget = resolveCameraHdrTarget(
            hdrCache,
            app,
            ext.sourceEntity,
            ext.hdr,
            resolved,
          );
          if (hdrTarget !== undefined) {
            currentHdr.perCamera.set(ext.sourceEntity, hdrTarget.view);
          }
          const viewport = ext.viewport ?? fullTargetViewport(resolved);
          mat4.invert(ext.viewMatrix, inverseViewScratch);
          // Advance the previous-frame cache with the unjittered matrix
          // regardless of jitter state, so toggling a temporal effect on or
          // off never injects a jitter offset into the next frame's motion
          // vectors.
          const prevViewProj = readAndAdvancePrevViewProj(
            prevFrame,
            ext.sourceEntity,
            ext.viewProjectionMatrix,
          );
          // Bake any requested sub-pixel offset into `view_proj`; the geometry
          // and depth-prepass passes draw with it, while motion vectors read
          // the untouched `unjittered_view_proj`. No entry → the two match.
          let jitteredViewProj = ext.viewProjectionMatrix as Float32Array;
          const offset = jitter.perCamera.get(ext.sourceEntity);
          if (offset !== undefined && (offset.x !== 0 || offset.y !== 0)) {
            const w = viewport.physicalSize.width;
            const h = viewport.physicalSize.height;
            const ndcX = w > 0 ? (offset.x * 2) / w : 0;
            const ndcY = h > 0 ? (offset.y * 2) / h : 0;
            jitterProjection(ext.projectionMatrix, ndcX, ndcY, jitteredProjScratch);
            mat4.multiply(jitteredProjScratch, ext.viewMatrix, jitteredViewProjScratch);
            jitteredViewProj = jitteredViewProjScratch as Float32Array;
          }
          writeViewUniform(
            cache.scratch,
            jitteredViewProj,
            ext.viewMatrix as Float32Array,
            inverseViewScratch as Float32Array,
            ext.projectionMatrix as Float32Array,
            ext.worldPosition as Float32Array,
            viewport,
            prevViewProj as Float32Array,
            ext.viewProjectionMatrix as Float32Array,
          );
          app.renderer.writeBuffer(slots.buffer, 0, cache.scratch as BufferSource);
          const { color, loadOp } = resolveClearColor(ext.clearColor, clearColor as ClearColor);
          const view: SortableCameraView = {
            renderEntity,
            sourceEntity: ext.sourceEntity,
            order: ext.order,
            target: resolved,
            mainColorTarget: hdrTarget ?? resolved,
            hdr: ext.hdr,
            depth,
            viewport,
            clearColor: color,
            loadOp,
            viewMatrix: ext.viewMatrix,
            projectionMatrix: ext.projectionMatrix,
            viewProjectionMatrix: ext.viewProjectionMatrix,
            worldPosition: ext.worldPosition,
            renderLayers: ext.renderLayers,
            viewBindGroup: slots.bindGroup,
            viewBuffer: slots.buffer,
            subGraph: ext.subGraph,
            _targetKind: targetKindOf(ext.target),
          };
          sortable.push(view);
        }
        // Garbage-collect depth textures for cameras absent this frame.
        for (const [entity, entry] of depthCache.perCamera) {
          if (!liveSourceEntities.has(entity)) {
            entry.view.destroy();
            entry.texture.destroy();
            depthCache.perCamera.delete(entity);
          }
        }
        // Same GC for the HDR intermediate cache.
        for (const [entity, entry] of hdrCache.perCamera) {
          if (!liveSourceEntities.has(entity)) {
            entry.view.destroy();
            entry.texture.destroy();
            hdrCache.perCamera.delete(entity);
          }
        }
        // GC previous-view-proj entries for cameras absent this frame.
        for (const entity of prevFrame.perCamera.keys()) {
          if (!liveSourceEntities.has(entity)) {
            prevFrame.perCamera.delete(entity);
          }
        }
        sortable.sort((a, b) => {
          if (a.order !== b.order) return a.order - b.order;
          const aOff = isOffscreen(a._targetKind);
          const bOff = isOffscreen(b._targetKind);
          if (aOff !== bOff) return aOff ? -1 : 1;
          return 0;
        });
        for (const v of sortable) sorted.views.push(v);
      },
      { set: RenderSet.Prepare, label: 'camera-prepare' },
    );
  }
}
