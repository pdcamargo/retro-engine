import type { Entity, World } from '@retro-engine/ecs';
import type { SerializedValue } from '@retro-engine/reflect';

import type { SerializedDerivedOverride } from './scene-data';

/**
 * A re-expression of a cross-boundary parent edge: an authored entity whose
 * `Parent` is a *derived* entity (one rebuilt on load, e.g. an instantiated glTF
 * node) cannot serialize that edge as a raw entity id — the target is excluded
 * from the save and would dangle. Instead the owning {@link CompositionProvider}
 * supplies the mount the derived entity belongs to plus a `kind`-tagged,
 * opaque `anchor` that a matching loader resolves back to a live entity once the
 * mount has re-instantiated.
 */
export interface CompositionAnchor {
  /**
   * The mount entity the derived target belongs to (e.g. the `GltfSceneRoot`
   * entity). It is itself authored and serialized, so it round-trips as an
   * ordinary entity reference.
   */
  readonly mount: Entity;
  /** Tag selecting the loader that resolves {@link anchor} (e.g. `'gltf-node'`). */
  readonly kind: string;
  /** Loader-defined locator for the target within the mount's instantiated subtree. */
  readonly anchor: unknown;
}

/**
 * A plugin's contribution to scene serialization composition: which entities it
 * derives (and therefore the serializer must exclude), and how to re-express an
 * authored entity's parent edge into that derived subtree as a stable
 * {@link CompositionAnchor}.
 *
 * Registered on the {@link CompositionRegistry} resource in a plugin's `build`.
 * This is the seam that lets a package such as `gltf` participate in
 * serialization without the engine depending on it.
 */
export interface CompositionProvider {
  /**
   * Entities this provider rebuilds on load (an instantiated subtree) and that
   * the serializer must omit — they are reconstructed from the mount, not
   * persisted directly.
   */
  excluded(world: World): Iterable<Entity>;
  /**
   * If `derived` is an entity this provider owns that an authored entity is
   * parented onto, return how to re-express that edge as a stable anchor on its
   * mount; otherwise `undefined`.
   */
  anchorFor(world: World, derived: Entity): CompositionAnchor | undefined;
}

/**
 * App resource accumulating {@link CompositionProvider}s contributed by plugins.
 * The scene serializer reads it to extend composition (extra excluded entities,
 * cross-boundary anchor re-emission) beyond the engine's built-in nested-scene
 * handling — without the engine importing the contributing packages.
 *
 * Always present on an `App` (the core plugin inserts it); a provider-free App
 * serializes identically to one with no registry.
 */
export class CompositionRegistry {
  readonly providers: CompositionProvider[] = [];

  /** Add a provider. Called by a plugin's `build`. */
  register(provider: CompositionProvider): void {
    this.providers.push(provider);
  }
}

/**
 * The decoded, not-yet-resolved form of a serialized attachment: an entity
 * loaded from a scene whose parent is a node in a subtree that has not been
 * instantiated yet. A `kind`-matching system (e.g. the glTF rebind system) waits
 * for the mount's subtree to exist, resolves {@link anchor} to a live entity,
 * parents this entity under it, and removes this component.
 *
 * Runtime-only: it carries no persistent identity (the persisted form is the
 * scene's `attach` record) and is never registered for reflection.
 */
export class PendingAttachment {
  constructor(
    /** The mount entity whose instantiated subtree holds the resolved parent. */
    readonly to: Entity,
    /** Tag selecting the system that resolves {@link anchor}. */
    readonly kind: string,
    /** Loader-defined locator for the parent within the mount's subtree. */
    readonly anchor: unknown,
  ) {}
}

/**
 * One derived entity's pristine state, captured the moment its subtree finished
 * instantiating — the components the source produced, plus the stable anchor
 * addressing it. The save-time diff compares the live entity against this to
 * emit only what the user changed.
 */
export interface CompositionBaselineEntry {
  /** Tag selecting the resolver for {@link anchor} (e.g. `'gltf-node'`). */
  readonly kind: string;
  /** Resolver-defined locator for the derived entity within its mount's subtree. */
  readonly anchor: unknown;
  /** The source-produced components, encoded, keyed by stable type name (excluding `Parent`). */
  readonly components: ReadonlyMap<string, SerializedValue>;
}

/**
 * A mount's snapshot of what its provider instantiated, keyed by the live derived
 * entity. The serializer diffs each live derived entity against its baseline to
 * record overrides; a baseline entry whose entity is no longer alive is a
 * deletion. Recomputed on every (re-)instantiation, so it is **runtime-only** and
 * never registered for reflection — like the derived subtree it describes.
 */
export class CompositionBaseline {
  constructor(readonly entries: ReadonlyMap<Entity, CompositionBaselineEntry>) {}
}

/**
 * The decoded, not-yet-applied derived overrides loaded from a scene, held on the
 * mount until its subtree re-instantiates. The generic override-apply system
 * resolves each anchor through the {@link CompositionResolverRegistry} and applies
 * the deltas, then removes this component.
 *
 * Runtime-only: the persisted form is the mount's `derived` scene record; never
 * registered for reflection.
 */
export class PendingCompositionOverrides {
  constructor(readonly overrides: readonly SerializedDerivedOverride[]) {}
}

/**
 * The load-time counterpart of a {@link CompositionProvider}'s anchoring: maps a
 * `kind`-tagged anchor back to its live derived entity once the mount's subtree
 * exists. Kept separate from `CompositionProvider` because anchoring is consulted
 * at *save* (App-only, to union exclusions) while resolution is consulted at
 * *load* (by the generic override-apply system) — a provider need not implement
 * both, and the built-in nested-scene path has no provider object at all.
 */
export interface CompositionResolver {
  /** Whether `mount`'s subtree has finished instantiating; overrides wait until this is true. */
  instantiated(world: World, mount: Entity): boolean;
  /** Resolve an anchor to its live derived entity within `mount`'s subtree, or `undefined`. */
  resolve(world: World, mount: Entity, anchor: unknown): Entity | undefined;
}

/**
 * App resource mapping an anchor `kind` to its {@link CompositionResolver}. A
 * plugin registers one in `build` (e.g. the glTF plugin registers `'gltf-node'`);
 * the engine's generic override-apply system looks resolvers up by the `kind`
 * recorded on each override. Always present on an `App` (the core plugin inserts
 * it).
 */
export class CompositionResolverRegistry {
  private readonly byKind = new Map<string, CompositionResolver>();

  /** Register the resolver for an anchor `kind`. Called by a plugin's `build`. */
  register(kind: string, resolver: CompositionResolver): void {
    this.byKind.set(kind, resolver);
  }

  /** The resolver for `kind`, or `undefined` if none is registered. */
  get(kind: string): CompositionResolver | undefined {
    return this.byKind.get(kind);
  }
}
