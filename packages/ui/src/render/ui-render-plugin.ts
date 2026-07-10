import type { Entity, Query as QueryHandle } from '@retro-engine/ecs';
import type { App, PluginObject } from '@retro-engine/engine';
import {
  Camera,
  CameraDriverLabel,
  DefaultFont,
  Extract,
  Fonts,
  MainCamera,
  Query,
  RenderGraph,
  RenderImages,
  RenderSet,
  Res,
  ResMut,
  SortedCameras,
} from '@retro-engine/engine';
import type { TextureFormat } from '@retro-engine/renderer-core';

import { UiCamera } from '../ui-camera';
import { ComputedLayout, UiNode } from '../ui-node';
import { UiImage } from '../ui-image';
import { UiViewport } from '../ui-plugin';
import { UiText } from '../ui-text';

import { makeUiImagePassNode, UiImagePassLabel } from './ui-image-pass-node';
import { UiImagePipeline } from './ui-image-pipeline';
import { prepareUiImages, type UiImageQuery } from './ui-image-prepare';
import { makeUiPassNode, UiPassLabel } from './ui-pass-node';
import { pickUiCameraView, UiRenderTargetState } from './ui-render-target';
import { makeUiTextPassNode, UiTextPassLabel } from './ui-text-pass-node';
import { UiPipeline } from './ui-pipeline';
import { UiTextPipeline } from './ui-text-pipeline';
import { prepareUiQuads, type UiQuadQuery } from './ui-prepare';
import { prepareUiText, type UiTextQuery } from './ui-text-prepare';

const devicePixelRatio = (): number =>
  typeof window !== 'undefined' && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;

type UiCameraQuery = QueryHandle<readonly [typeof Camera, typeof UiCamera]>;
type UiMainCameraQuery = QueryHandle<readonly [typeof Camera, typeof UiCamera, typeof MainCamera]>;

/**
 * The color format the UI pipelines must build against for this frame: the UI
 * camera target's format if resolved, else the surface format for the overlay
 * fallback, else `undefined` (nothing to render into — skip).
 */
const uiTargetFormat = (app: App, state: UiRenderTargetState): TextureFormat | undefined => {
  if (state.target !== null) return state.target.format;
  if (!state.overlayFallback) return undefined;
  return app.getSurface()?.format;
};

/** Options for {@link UiRenderPlugin}. */
export interface UiRenderPluginOptions {
  /**
   * When no {@link UiCamera} is present, draw the UI as a full-surface overlay on
   * the swapchain (the pre-camera-bound behavior). Defaults to `true` so games
   * without a UI camera render as before. Hosts that render into offscreen
   * textures (e.g. the studio) set this `false` so the UI never draws over their
   * own surface — it only renders when a UI camera resolves a target.
   */
  readonly overlayWhenNoCamera?: boolean;
}

/**
 * Draws the in-game UI (`backgroundColor` quads, images, text) into the
 * {@link UiCamera} camera's render target — the swapchain for a primary camera or
 * an offscreen texture for a texture camera — sized to that target. Add it
 * alongside {@link UiPlugin}, which produces the `ComputedLayout` this consumes.
 *
 * With no UI camera the UI falls back to a full-surface overlay
 * ({@link UiRenderPluginOptions.overlayWhenNoCamera}, default on). On `build` it
 * inserts the pipelines + {@link UiRenderTargetState}, resolves the UI target /
 * {@link UiViewport} each frame in `RenderSet.Prepare`, and registers the prepare
 * systems. On `finish` it adds the three UI pass nodes after all camera work.
 * Headless-safe: with no surface the prepare/pass steps no-op.
 */
export class UiRenderPlugin implements PluginObject {
  private readonly overlayWhenNoCamera: boolean;

  constructor(options: UiRenderPluginOptions = {}) {
    this.overlayWhenNoCamera = options.overlayWhenNoCamera ?? true;
  }

  name(): string {
    return 'UiRenderPlugin';
  }

  build(app: App): void {
    if (app.getResource(UiPipeline) === undefined) app.insertResource(new UiPipeline());
    if (app.getResource(UiImagePipeline) === undefined) app.insertResource(new UiImagePipeline());
    if (app.getResource(UiTextPipeline) === undefined) app.insertResource(new UiTextPipeline());
    if (app.getResource(UiRenderTargetState) === undefined) {
      app.insertResource(new UiRenderTargetState());
    }
    app.getResource(UiRenderTargetState)!.overlayFallback = this.overlayWhenNoCamera;

    // Resolve the UI camera's target for this frame and size the viewport to it.
    // Runs after `camera-prepare` (which builds SortedCameras with resolved
    // targets) and before the UI prepare steps that read UiViewport.
    app.addSystem(
      'render',
      [
        Res(SortedCameras),
        // Render-stage component reads go through Extract to see the main world.
        Extract(Query([Camera, UiCamera])),
        Extract(Query([Camera, UiCamera, MainCamera])),
        ResMut(UiViewport),
        ResMut(UiRenderTargetState),
      ],
      (sorted, uiCams, uiMainCams, viewport, state) => {
        const vp = viewport as UiViewport;
        const st = state as UiRenderTargetState;
        const views = (sorted as SortedCameras).views;

        const uiCameras = new Set<number>();
        const targetKindByEntity = new Map<number, string>();
        for (const row of (uiCams as UiCameraQuery).entries()) {
          const entity = row[0] as Entity;
          uiCameras.add(entity);
          targetKindByEntity.set(entity, (row[1] as Camera).target.kind);
        }
        const mainCameras = new Set<number>();
        for (const row of (uiMainCams as UiMainCameraQuery).entries()) mainCameras.add(row[0] as Entity);

        const view = pickUiCameraView(uiCameras, mainCameras, views);
        if (view !== undefined) {
          st.target = view.target;
          // A surface / primary target is measured in physical pixels, so map to
          // logical (÷ DPR) as the overlay did; an offscreen texture / view target
          // already is its own logical resolution, so use it 1:1.
          const kind = targetKindByEntity.get(view.sourceEntity);
          const dpr = kind === 'texture' || kind === 'view' ? 1 : devicePixelRatio();
          vp.width = Math.max(1, Math.round(view.target.width / dpr));
          vp.height = Math.max(1, Math.round(view.target.height / dpr));
          return;
        }

        // No UI camera: overlay fallback sizes to the surface (legacy behavior).
        st.target = null;
        if (!st.overlayFallback) return;
        const surface = app.getSurface();
        if (surface === undefined) return;
        const dpr = devicePixelRatio();
        vp.width = Math.max(1, Math.round(surface.width / dpr));
        vp.height = Math.max(1, Math.round(surface.height / dpr));
      },
      { set: RenderSet.Prepare, label: 'ui-viewport-sync', after: ['camera-prepare'] },
    );

    app.addSystem(
      'render',
      [Extract(Query([UiNode, ComputedLayout])), Res(UiViewport), ResMut(UiPipeline), Res(UiRenderTargetState)],
      (nodes, viewport, pipeline, state) => {
        const fmt = uiTargetFormat(app, state as UiRenderTargetState);
        if (fmt === undefined) return;
        prepareUiQuads(app, nodes as unknown as UiQuadQuery, viewport as UiViewport, pipeline as UiPipeline, fmt);
      },
      { set: RenderSet.Prepare, label: 'ui-prepare', after: ['ui-viewport-sync'] },
    );

    app.addSystem(
      'render',
      [
        Extract(Query([UiNode, ComputedLayout, UiImage])),
        Res(UiViewport),
        ResMut(UiImagePipeline),
        Res(UiRenderTargetState),
      ],
      (nodes, viewport, pipeline, state) => {
        const renderImages = app.getResource(RenderImages);
        if (renderImages === undefined) return;
        const fmt = uiTargetFormat(app, state as UiRenderTargetState);
        if (fmt === undefined) return;
        prepareUiImages(
          app,
          nodes as unknown as UiImageQuery,
          viewport as UiViewport,
          renderImages,
          pipeline as UiImagePipeline,
          fmt,
        );
      },
      { set: RenderSet.Prepare, label: 'ui-image-prepare', after: ['ui-viewport-sync'] },
    );

    app.addSystem(
      'render',
      [
        Extract(Query([UiNode, ComputedLayout, UiText])),
        Res(UiViewport),
        ResMut(UiTextPipeline),
        Res(UiRenderTargetState),
      ],
      (nodes, viewport, pipeline, state) => {
        // Fonts (from TextPlugin) is optional; without it there is no UI text to draw.
        const fonts = app.getResource(Fonts);
        const renderImages = app.getResource(RenderImages);
        if (fonts === undefined || renderImages === undefined) return;
        const fmt = uiTargetFormat(app, state as UiRenderTargetState);
        if (fmt === undefined) return;
        prepareUiText(
          app,
          nodes as unknown as UiTextQuery,
          viewport as UiViewport,
          fonts,
          renderImages,
          pipeline as UiTextPipeline,
          fmt,
          app.getResource(DefaultFont)?.handle,
        );
      },
      { set: RenderSet.Prepare, label: 'ui-text-prepare', after: ['ui-viewport-sync'] },
    );
  }

  finish(app: App): void {
    const graph = app.getResource(RenderGraph);
    if (graph === undefined) {
      throw new Error(
        'UiRenderPlugin: RenderGraph resource missing at finish(); the engine CorePlugin must build before UiRenderPlugin.',
      );
    }
    graph.addNode(makeUiPassNode());
    graph.addEdge(CameraDriverLabel, UiPassLabel);
    // Images draw after (over) the background quads.
    graph.addNode(makeUiImagePassNode());
    graph.addEdge(UiPassLabel, UiImagePassLabel);
    // Text draws after (over) images and backgrounds.
    graph.addNode(makeUiTextPassNode());
    graph.addEdge(UiImagePassLabel, UiTextPassLabel);
  }
}
