import { Assets } from '@retro-engine/assets';

import { Font } from './font-asset';

/**
 * App-level store mapping {@link import('@retro-engine/assets').Handle}s to
 * {@link Font} instances.
 *
 * Inserted as a main-world resource by `TextPlugin`. The font importer registers
 * a loaded font here (its atlas image is registered as a labeled sub-asset in
 * `Images`); a `Text2d` component holds the resulting `Handle<Font>`. Buffers
 * lifecycle events the way every {@link Assets} store does.
 */
export class Fonts extends Assets<Font> {}
