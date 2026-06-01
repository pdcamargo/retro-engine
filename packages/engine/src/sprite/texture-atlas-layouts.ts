import { Assets } from '@retro-engine/assets';

import type { TextureAtlasLayout } from './texture-atlas-layout';

/**
 * App-level store mapping {@link import('@retro-engine/assets').Handle}s to
 * {@link TextureAtlasLayout} instances.
 *
 * Inserted as a main-world resource by `SpritePlugin`. Gameplay / spawn-time
 * code calls `layouts.add(layout)` to register a layout and gets back a
 * `Handle<TextureAtlasLayout>`; {@link TextureAtlas} components on entities
 * hold the handle. Layouts are typically immutable — `insert` overwrites a
 * handle's value for hot-reload and tooling use cases, queuing a `modified`
 * event the store buffers alongside `added` / `removed`.
 */
export class TextureAtlasLayouts extends Assets<TextureAtlasLayout> {}
