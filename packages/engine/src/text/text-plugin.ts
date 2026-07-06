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
import { RenderSet } from '../render-set';
import { ShaderRegistry } from '../shader/shader-registry';
import { Extract, Query, Res, ResMut } from '../system-param';
import { GlobalTransform } from '../transform';
import { ViewVisibility } from '../visibility/visibility';

import type { Font } from './font-asset';
import { createFontImporter } from './font-importer';
import { Fonts } from './fonts';
import { TextPreparedBatches } from './text-batch';
import { TextInstanceBuffer } from './text-instance-buffer';
import { TextPipeline } from './text-pipeline';
import { prepareText, queueText, type TextQuery } from './text-render';
import { TEXT_WGSL } from './text.wgsl';
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

    // Every authored field persists: the string, the font handle, and its visual
    // styling. No derived state, so the whole component is serialized.
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
  }
}
