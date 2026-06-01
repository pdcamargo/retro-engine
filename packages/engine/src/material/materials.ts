import { Assets } from '@retro-engine/assets';

import type { Material } from './material';

/**
 * App-level store mapping {@link import('@retro-engine/assets').Handle}s to
 * material instances of type `M`.
 *
 * `MaterialPlugin<M>` synthesizes a uniquely-named subclass of this per
 * material type and inserts it as a main-world resource, so each material type
 * gets its own store. Gameplay / spawn-time code calls `materials.add(material)`
 * to register a material and gets back a `Handle<M>`; `MeshMaterial3d<M>`
 * components hold the handle. The store buffers lifecycle events (`added` /
 * `modified` / `removed`) that the plugin's extract system drains once per
 * frame and forwards into the render world.
 */
export class Materials<M extends Material> extends Assets<M> {}
