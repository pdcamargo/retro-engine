import type { AssetMetaData } from '../save/meta';

import type { App } from '../index';

/**
 * Declarative description of one asset kind: the cross-cutting catalog metadata
 * that decides how a file of this kind is discovered, identified, and shown —
 * separate from how it is loaded or serialized (those stay with the
 * {@link AssetServer} loader map and `AssetSerializers`). Registering one
 * descriptor in a plugin's `build` is how a new asset kind joins the catalog.
 */
export interface AssetKindDescriptor {
  /**
   * The asset-kind tag written into the `.meta` sidecar and the manifest entry
   * (e.g. `'Image'`, `'Mesh'`, `'Gltf'`). Unique across descriptors.
   */
  readonly kind: string;
  /**
   * File extensions this kind claims, each without a leading dot and lowercased
   * (e.g. `['glb', 'gltf']`). Drives sidecar discovery and the studio's
   * file-watch classification.
   */
  readonly extensions: readonly string[];
  /**
   * Whether a loose file of one of these extensions, found with no sibling
   * `.meta`, should get a fresh sidecar minted on discovery. True for source
   * assets a user drops in (images, glTF); false for files that only ever exist
   * because a save wrote them *with* a sidecar (meshes, scenes, bundles,
   * materials) — a loose one of those is a corruption, not a discovery.
   */
  readonly discoverable: boolean;
  /**
   * Whether this kind's bytes are large and streamed rather than embedded
   * (textures, glTF). Advisory metadata for tooling; does not affect discovery.
   */
  readonly largeBinary?: boolean;
  /**
   * Optional UI-category hint (a plain string such as `'model'` or `'image'`)
   * for tooling that groups assets by type. Kept a string rather than a fixed
   * union so this package stays free of any editor dependency; consumers map it
   * to their own category type.
   */
  readonly category?: string;
  /**
   * Produces the default per-kind `data` body for a freshly minted sidecar. Omit
   * for kinds whose sidecar carries only identity (no `data`).
   */
  readonly defaultMeta?: () => AssetMetaData;
}

/**
 * The catalog of every registered asset kind. Each kind-owning plugin registers
 * its descriptor in `build` via {@link registerAssetKind}; sidecar discovery, the
 * studio file-watcher, and the asset browser read it instead of hard-coded lists.
 *
 * It does not own loaders, serializers, or stores — those stay with the
 * {@link AssetServer}, `AssetSerializers`, and `AssetStores`. Derived registry —
 * never serialized.
 */
export class AssetKinds {
  private readonly byKind = new Map<string, AssetKindDescriptor>();
  private readonly byExt = new Map<string, AssetKindDescriptor>();

  /**
   * Register `descriptor`, indexing it by kind and by each claimed extension. A
   * later registration for the same kind replaces the earlier one.
   *
   * An extension is indexed for discovery only for a {@link AssetKindDescriptor.discoverable}
   * kind, and at most one discoverable kind may claim a given extension (a
   * genuine wiring conflict throws). Several non-discoverable kinds may share an
   * extension — the materials case, where many kinds share `.remat` and route by
   * kind, not extension — so a shared non-discoverable extension is simply not
   * added to the discovery index.
   *
   * @throws if two discoverable kinds claim the same extension.
   */
  register(descriptor: AssetKindDescriptor): void {
    this.byKind.set(descriptor.kind, descriptor);
    if (!descriptor.discoverable) return;
    for (const raw of descriptor.extensions) {
      const ext = raw.toLowerCase();
      const existing = this.byExt.get(ext);
      if (existing !== undefined && existing.kind !== descriptor.kind) {
        throw new Error(
          `AssetKinds.register: extension '.${ext}' is already claimed for discovery by kind '${existing.kind}', cannot also assign it to '${descriptor.kind}'.`,
        );
      }
      this.byExt.set(ext, descriptor);
    }
  }

  /** The descriptor registered for `kind`, or `undefined` if none. */
  get(kind: string): AssetKindDescriptor | undefined {
    return this.byKind.get(kind);
  }

  /**
   * The discoverable descriptor that claims `ext` (without a leading dot, case
   * insensitive), or `undefined` if no discoverable kind owns it.
   */
  forExtension(ext: string): AssetKindDescriptor | undefined {
    return this.byExt.get(ext.toLowerCase());
  }

  /** Every registered descriptor. */
  all(): IterableIterator<AssetKindDescriptor> {
    return this.byKind.values();
  }

  /** Every extension claimed by any registered kind, lowercased and dot-free. */
  extensions(): readonly string[] {
    const out = new Set<string>();
    for (const d of this.byKind.values()) {
      for (const ext of d.extensions) out.add(ext.toLowerCase());
    }
    return [...out];
  }
}

/**
 * Register `descriptor` on the App's {@link AssetKinds} resource, creating it on
 * first use. Call from a kind-owning plugin's `build`, alongside the loader /
 * store / serializer registrations for the same kind.
 */
export const registerAssetKind = (app: App, descriptor: AssetKindDescriptor): void => {
  let kinds = app.getResource(AssetKinds);
  if (kinds === undefined) {
    kinds = new AssetKinds();
    app.insertResource(kinds);
  }
  kinds.register(descriptor);
};
