import { t } from '@retro-engine/reflect';

import { registerAssetKind } from '../asset/asset-kinds';
import { AssetServer } from '../asset/asset-server';
import { ASSET_TYPE, registerAssetStore } from '../asset/asset-stores';
import { SortedCameras } from '../camera/sorted-cameras';
import { Images } from '../image/images';
import { RenderImages } from '../image/image-plugin';
import type { App } from '../index';
import type { PluginObject } from '../plugin';
import { ViewPhases2d } from '../render-graph/phase-2d';
import { ViewPhases3d } from '../render-graph/phase-3d';
import { RenderSet } from '../render-set';
import { ShaderRegistry } from '../shader/shader-registry';
import { Extract, Query, Res, ResMut } from '../system-param';
import { GlobalTransform } from '../transform';
import { ViewVisibility } from '../visibility/visibility';

import { TEXT3D_WGSL } from './text-3d.wgsl';
import { DefaultFont, installDefaultFont } from './default-font';
import type { Font } from './font-asset';
import { createFontImporter } from './font-importer';
import { Fonts } from './fonts';
import { TextPreparedBatches } from './text-batch';
import { Text3dPreparedBatches } from './text-batch-3d';
import { TextInstanceBuffer } from './text-instance-buffer';
import { Text3dInstanceBuffer } from './text-instance-buffer-3d';
import { TextPipeline } from './text-pipeline';
import { Text3dPipeline } from './text-pipeline-3d';
import { prepareText, queueText, type TextQuery } from './text-render';
import { prepareText3d, queueText3d, type Text3dQuery } from './text-render-3d';
import { TEXT_WGSL } from './text.wgsl';
import { Text } from './text3d';
import { Text2d } from './text2d';

/**
 * Engine plugin owning the MSDF text data + render layers.
 *
 * On `build`:
 *
 * - Inserts {@link Fonts} and registers it as the store for `ASSET_TYPE.font`.
 * - Catalogs the discoverable `.font` asset kind and registers the `.font`
 *   loader (MSDF descriptor + linear atlas sub-asset) against the
 *   {@link AssetServer}.
 * - Registers the {@link Text2d} reflection schema.
 * - Registers the `retro_engine::text` MSDF shader, the {@link TextPipeline},
 *   {@link TextInstanceBuffer}, and {@link TextPreparedBatches} render-world
 *   resources, and the `RenderSet.Prepare` (`text-prepare`, after
 *   `image-prepare`) + `RenderSet.Queue` (`text-queue`) systems that lay out
 *   visible text, pack glyph quads, and queue them into the transparent 2D
 *   phase.
 *
 * Requires {@link Images} (from `ImagePlugin`) and the shader/camera resources
 * (`ShaderPlugin`/`CameraPlugin`) — all provided by `CorePlugin`. Consumers add
 * this plugin alongside `SpritePlugin` when they want game-facing text.
 */
export class TextPlugin implements PluginObject {
  name(): string {
    return 'TextPlugin';
  }

  build(app: App): void {
    if (app.getResource(Fonts) === undefined) {
      app.insertResource(new Fonts());
    }
    const fonts = app.getResource(Fonts)!;
    registerAssetStore(app, ASSET_TYPE.font, fonts);
    // A `.font` descriptor (msdf-atlas-gen JSON) is dropped in beside its atlas
    // `.png`; a loose one with no sidecar is discovered and gets one minted.
    registerAssetKind(app, {
      kind: ASSET_TYPE.font,
      extensions: ['font'],
      discoverable: true,
      category: 'font',
    });

    const images = app.getResource(Images);
    if (images === undefined) {
      throw new Error(
        'TextPlugin: Images resource missing; ImagePlugin must run before TextPlugin.',
      );
    }

    // Deferred so plugin order does not matter: the loader registers the moment
    // an AssetServer exists (immediately if already present), before any scene loads.
    app.whenResource(AssetServer, (server) => {
      server.registerLoader('font', fonts, createFontImporter(images));
    });

    registerTextComponents(app);

    // Install the engine's built-in default font so `UiText` / `Text` render with
    // no font asset on disk (the UI text layer falls back to it). Needs Images
    // (from ImagePlugin, part of CorePlugin); skipped in a headless setup without
    // it. Idempotent, so an explicit installDefaultFont() call reuses this one.
    if (app.getResource(Images) !== undefined && app.getResource(DefaultFont) === undefined) {
      installDefaultFont(app);
    }

    // ---- Render layer ----
    const registry = app.getResource(ShaderRegistry);
    if (registry === undefined) {
      throw new Error(
        'TextPlugin: ShaderRegistry resource missing; ShaderPlugin must run before TextPlugin.',
      );
    }
    if (!registry.has('retro_engine::text')) {
      registry.register('retro_engine::text', TEXT_WGSL);
    }
    if (app.getResource(TextPipeline) === undefined) app.insertResource(new TextPipeline());
    if (app.getResource(TextInstanceBuffer) === undefined) {
      app.insertResource(new TextInstanceBuffer());
    }
    if (app.getResource(TextPreparedBatches) === undefined) {
      app.insertResource(new TextPreparedBatches());
    }
    if (app.getResource(ViewPhases2d) === undefined) app.insertResource(new ViewPhases2d());

    app.addSystem(
      'render',
      [
        Extract(Query([Text2d, GlobalTransform, ViewVisibility])),
        Res(Fonts),
        Res(RenderImages),
        ResMut(TextInstanceBuffer),
        ResMut(TextPreparedBatches),
      ],
      (texts, fontStore, renderImages, instanceBuffer, prepared) => {
        (prepared as TextPreparedBatches).batches.length = 0;
        (instanceBuffer as TextInstanceBuffer).count = 0;
        prepareText(
          app,
          texts as unknown as TextQuery,
          fontStore as Fonts,
          renderImages as RenderImages,
          instanceBuffer as TextInstanceBuffer,
          prepared as TextPreparedBatches,
        );
      },
      { set: RenderSet.Prepare, label: 'text-prepare', after: ['image-prepare'] },
    );

    app.addSystem(
      'render',
      [
        Res(SortedCameras),
        Res(RenderImages),
        ResMut(TextPipeline),
        ResMut(TextInstanceBuffer),
        ResMut(TextPreparedBatches),
        ResMut(ViewPhases2d),
      ],
      (cameras, renderImages, pipeline, instanceBuffer, prepared, phases) => {
        queueText(
          app,
          cameras as unknown as SortedCameras,
          renderImages as RenderImages,
          pipeline as TextPipeline,
          instanceBuffer as TextInstanceBuffer,
          prepared as TextPreparedBatches,
          phases as ViewPhases2d,
        );
      },
      { set: RenderSet.Queue, label: 'text-queue', after: ['text-prepare'] },
    );

    // ---- World-space (3D) text render layer ----
    if (!registry.has('retro_engine::text3d')) {
      registry.register('retro_engine::text3d', TEXT3D_WGSL);
    }
    if (app.getResource(Text3dPipeline) === undefined) app.insertResource(new Text3dPipeline());
    if (app.getResource(Text3dInstanceBuffer) === undefined) app.insertResource(new Text3dInstanceBuffer());
    if (app.getResource(Text3dPreparedBatches) === undefined) app.insertResource(new Text3dPreparedBatches());
    if (app.getResource(ViewPhases3d) === undefined) app.insertResource(new ViewPhases3d());

    app.addSystem(
      'render',
      [
        Extract(Query([Text, GlobalTransform, ViewVisibility])),
        Res(Fonts),
        Res(RenderImages),
        ResMut(Text3dInstanceBuffer),
        ResMut(Text3dPreparedBatches),
      ],
      (texts, fontStore, renderImages, instanceBuffer, prepared) => {
        (prepared as Text3dPreparedBatches).batches.length = 0;
        (instanceBuffer as Text3dInstanceBuffer).count = 0;
        prepareText3d(
          app,
          texts as unknown as Text3dQuery,
          fontStore as Fonts,
          renderImages as RenderImages,
          instanceBuffer as Text3dInstanceBuffer,
          prepared as Text3dPreparedBatches,
        );
      },
      { set: RenderSet.Prepare, label: 'text3d-prepare', after: ['image-prepare'] },
    );

    app.addSystem(
      'render',
      [
        Res(SortedCameras),
        Res(RenderImages),
        ResMut(Text3dPipeline),
        ResMut(Text3dInstanceBuffer),
        ResMut(Text3dPreparedBatches),
        ResMut(ViewPhases3d),
      ],
      (cameras, renderImages, pipeline, instanceBuffer, prepared, phases) => {
        queueText3d(
          app,
          cameras as unknown as SortedCameras,
          renderImages as RenderImages,
          pipeline as Text3dPipeline,
          instanceBuffer as Text3dInstanceBuffer,
          prepared as Text3dPreparedBatches,
          phases as ViewPhases3d,
        );
      },
      { set: RenderSet.Queue, label: 'text3d-queue', after: ['text3d-prepare'] },
    );
  }
}

/**
 * Register the reflection schemas for the text components: {@link Text2d}
 * (screen-space) and {@link Text} (world-space 3D) — without installing the text
 * render pipeline or systems. Every authored field persists (string, font handle,
 * and visual styling); there is no derived state, so the whole component is
 * serialized.
 *
 * {@link TextPlugin} calls this during `build`; tools that need the text
 * component types available for authoring or serialization (e.g. an editor's
 * component palette) can call it directly to register the types without the
 * renderer.
 */
export const registerTextComponents = (app: App): void => {
  app.registerComponent(
    Text2d,
    {
      text: t.string,
      font: t.handle<Font>(ASSET_TYPE.font).optional(),
      fontSize: t.number,
      color: t.vec4,
      align: t.enum('left', 'center', 'right'),
      lineHeight: t.number.optional(),
      maxWidth: t.number.optional(),
      letterSpacing: t.number,
      anchor: t.vec2,
    },
    { name: 'Text2d', make: () => new Text2d() },
  );

  // World-space (3D) text — same authored fields as Text2d; the difference is
  // the render path (3D camera + depth), not the data.
  app.registerComponent(
    Text,
    {
      text: t.string,
      font: t.handle<Font>(ASSET_TYPE.font).optional(),
      fontSize: t.number,
      color: t.vec4,
      align: t.enum('left', 'center', 'right'),
      lineHeight: t.number.optional(),
      maxWidth: t.number.optional(),
      letterSpacing: t.number,
      anchor: t.vec2,
    },
    { name: 'Text', make: () => new Text() },
  );
};
