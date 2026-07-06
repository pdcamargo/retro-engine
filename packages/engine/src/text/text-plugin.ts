import { t } from '@retro-engine/reflect';

import { registerAssetKind } from '../asset/asset-kinds';
import { AssetServer } from '../asset/asset-server';
import { ASSET_TYPE, registerAssetStore } from '../asset/asset-stores';
import { Images } from '../image/images';
import type { App } from '../index';
import type { PluginObject } from '../plugin';

import type { Font } from './font-asset';
import { createFontImporter } from './font-importer';
import { Fonts } from './fonts';
import { Text2d } from './text2d';

/**
 * Engine plugin owning the text data layer: the {@link Fonts} store, the `.font`
 * asset kind + loader (MSDF descriptor + companion atlas image), and the
 * {@link Text2d} component's reflection schema.
 *
 * On `build`:
 *
 * - Inserts {@link Fonts} and registers it as the store for `ASSET_TYPE.font`,
 *   so a scene's `Text2d.font` handle resolves by GUID.
 * - Catalogs the `.font` asset kind (discoverable — a loose descriptor beside
 *   its atlas image is picked up and given a sidecar).
 * - Registers the `.font` loader against the {@link AssetServer} once available,
 *   decoding the atlas into a linear image sub-asset in {@link Images}.
 * - Registers the {@link Text2d} reflection schema so text entities round-trip
 *   through a saved scene.
 *
 * Requires {@link Images} (from `ImagePlugin`) to exist so the font loader has a
 * store to register its atlas sub-asset into. The glyph render pipeline is a
 * separate concern and is not installed here.
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
  }
}
