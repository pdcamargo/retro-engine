import type { SerializedValue } from '@retro-engine/reflect';

/**
 * A named, reusable group of components with their authored default values — the
 * engine's introspectable equivalent of a Bevy bundle.
 *
 * A bundle is a pure authoring-time template: spawning it stamps fresh,
 * independent component instances onto an entity, after which the entity has no
 * link back to the definition. Editing a spawned entity never feeds back to the
 * bundle, and editing the bundle never retroactively changes already-spawned
 * entities.
 *
 * Its components are stored as {@link SerializedValue}s — the same
 * `{ type, version, data }` shape a scene or a material asset uses — so a
 * code-defined bundle (registered via `App.registerBundle`) and a user-authored
 * bundle asset share one representation. Asset handles round-trip by GUID;
 * bundle components may not reference entities.
 */
export interface BundleDefinition {
  /** Stable, unique name — the palette label and the key in {@link import('./bundle-registry').AppBundleRegistry}. */
  readonly name: string;
  /** The bundle's components, in insertion order, each as `{ type, version, data }`. */
  readonly components: readonly SerializedValue[];
  /** Optional icon hint for a tooling palette (e.g. a Lucide icon name). */
  readonly icon?: string;
  /** Optional category trail for grouping in a tooling palette (e.g. `['Gameplay']`). */
  readonly category?: readonly string[];
  /** Optional one-line description shown in a tooling palette. */
  readonly description?: string;
}

/** Optional presentation metadata for {@link import('../index').App.registerBundle}. */
export interface BundleRegisterOptions {
  /** Icon hint for a tooling palette. */
  readonly icon?: string;
  /** Category trail for grouping in a tooling palette. */
  readonly category?: readonly string[];
  /** One-line description shown in a tooling palette. */
  readonly description?: string;
}
