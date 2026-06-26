import type {
  AssetGuid,
  AssetImporter,
  AssetManifest,
  AssetSource,
  Assets,
  Handle,
  LoadContext,
} from '@retro-engine/assets';
import { parseAssetManifest, parseSubAssetGuid, subAssetGuid } from '@retro-engine/assets';

import type { Logger } from '../log';
import { engineLogger } from '../log';

import { decodeDataUri, isDataUri, resolveSiblingPath } from './sibling-path';

/**
 * A load that finished its off-schedule IO and is waiting for the drain to
 * commit it into its store. The drain calls `store.insert(handle, value)`,
 * which queues the store's `added` (fresh slot) or `modified` (reload) event.
 *
 * The triple is type-erased — one queue carries completions for every asset
 * type — but `store`, `handle`, and `value` always belong together, so the
 * `insert` the drain performs is sound.
 */
export interface CompletedLoad {
  readonly store: Assets<unknown>;
  readonly handle: Handle<unknown>;
  readonly value: unknown;
}

/**
 * A load whose IO rejected or whose importer threw. Recorded so tooling can
 * surface it; also logged at `warn` when it happens. The reserved handle is
 * kept (its slot stays empty) so a later {@link AssetServer.reload} can retry
 * into the same handle.
 */
export interface AssetLoadFailure {
  readonly path: string;
  readonly handle: Handle<unknown>;
  readonly error: unknown;
}

interface LoaderEntry {
  readonly store: Assets<unknown>;
  readonly importer: AssetImporter<unknown>;
}

/**
 * Derive the lowercased file extension from a load path, ignoring any query or
 * fragment. Throws when the path has no usable extension (no dot, a leading-dot
 * dotfile, or a trailing dot), since the server resolves loaders by extension.
 */
const extensionOf = (path: string): string => {
  const clean = path.split(/[?#]/, 1)[0] ?? path;
  const base = clean.slice(clean.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) {
    throw new Error(`AssetServer: cannot derive a file extension from path '${path}'.`);
  }
  return base.slice(dot + 1).toLowerCase();
};

const normalizeExtension = (extension: string): string =>
  extension.toLowerCase().replace(/^\./, '');

/**
 * The engine's single asset-loading entry point. Given a {@link AssetSource}
 * (injected at construction — fetch-backed on the web, a disk or bundle source
 * elsewhere) and per-extension loaders, it turns a path into a usable
 * {@link Handle} immediately and runs the read + decode off-schedule.
 *
 * Loading is split in two so gameplay never awaits an asset:
 *
 * 1. {@link AssetServer.load} reserves a store slot and returns its
 *    `Handle<T>` synchronously. An entity can reference the asset on the same
 *    line. `assets.get(handle)` stays `undefined` until the value arrives.
 * 2. The IO (`source.read` then the registered importer) runs as a promise.
 *    Its result lands in an internal completion queue — it does **not** mutate
 *    any store directly, keeping ECS mutation deterministic and on-schedule.
 * 3. A schedule-bound drain (installed by `AssetPlugin` in `PreUpdate`) moves
 *    completed loads into their `Assets<T>` store, which queues the store's
 *    `added` / `modified` event for downstream extraction.
 *
 * A loader binds an extension to both an importer and the target
 * `Assets<T>` store, because {@link AssetServer.load} is given only a path and
 * each asset type has its own store. Loaders register through a plugin's
 * `build`, never by subclassing.
 */
export class AssetServer {
  private readonly source: AssetSource;
  private readonly logger: Logger;
  private readonly loaders = new Map<string, LoaderEntry>();
  /**
   * Loaders keyed by asset `kind` rather than file extension. `loadByGuid`
   * prefers one of these when the manifest entry's kind matches — the case
   * where one extension maps to many stores (e.g. every material type shares
   * `.remat` but loads into its own `Materials<M>` store).
   */
  private readonly kindLoaders = new Map<string, LoaderEntry>();
  /**
   * Stores that hold a container's labeled sub-assets, keyed by the label prefix
   * the importer emits (e.g. `'Animation'` for `'Animation0'`). A sub-asset
   * reference (`"<parentGuid>#<label>"`) resolves by matching its label against
   * these prefixes to find the owning store, then loading the parent so its
   * {@link LoadContext.addLabeledAsset} fills the reserved slot.
   */
  private readonly subAssetStores = new Map<string, Assets<unknown>>();
  private readonly pathToHandle = new Map<
    string,
    { readonly handle: Handle<unknown>; readonly store: Assets<unknown> }
  >();
  private completed: CompletedLoad[] = [];
  private failures: AssetLoadFailure[] = [];
  private readonly inflight = new Set<Promise<void>>();
  private manifest?: AssetManifest;
  private readonly guidToHandle = new Map<
    AssetGuid,
    { readonly handle: Handle<unknown>; readonly store: Assets<unknown> }
  >();

  constructor(options: { readonly source: AssetSource; readonly logger?: Logger }) {
    this.source = options.source;
    this.logger = options.logger ?? engineLogger;
  }

  /**
   * Bind a loader to a file `extension` (with or without a leading dot, case
   * insensitive). `store` is the `Assets<T>` the loaded value is inserted into;
   * `importer` decodes raw bytes into the asset. Throws if the extension is
   * already registered.
   */
  registerLoader<T>(extension: string, store: Assets<T>, importer: AssetImporter<T>): void {
    const ext = normalizeExtension(extension);
    if (this.loaders.has(ext)) {
      throw new Error(`AssetServer.registerLoader: a loader is already registered for '.${ext}'.`);
    }
    this.loaders.set(ext, {
      store: store as Assets<unknown>,
      importer: importer as AssetImporter<unknown>,
    });
  }

  /**
   * Bind a loader to an asset `kind` (the `.meta` kind tag), for asset types
   * where one file extension maps to many stores. {@link AssetServer.loadByGuid}
   * prefers a kind loader over the extension loader when the manifest entry's
   * kind matches. Idempotent re-registration of the same kind is allowed (the
   * latest wins) so a hot-reloaded material plugin can re-register cleanly.
   */
  registerLoaderByKind<T>(kind: string, store: Assets<T>, importer: AssetImporter<T>): void {
    this.kindLoaders.set(kind, {
      store: store as Assets<unknown>,
      importer: importer as AssetImporter<unknown>,
    });
  }

  /**
   * Bind the store that holds a container's labeled sub-assets to the label
   * `prefix` the importer emits for them — `'Animation'` for an importer that
   * labels clips `'Animation0'`, `'Animation1'`, … This lets
   * {@link AssetServer.loadByGuid} resolve a sub-asset reference
   * (`"<parentGuid>#<label>"`) to a handle: it matches the label's prefix here to
   * find the store, reserves the slot, and loads the parent so the parent's
   * {@link LoadContext.addLabeledAsset} fills that same slot by GUID.
   *
   * Idempotent re-registration of the same prefix is allowed (the latest wins).
   */
  registerSubAssetStore<T>(prefix: string, store: Assets<T>): void {
    this.subAssetStores.set(prefix, store as Assets<unknown>);
  }

  /** The sub-asset store whose registered prefix `label` starts with, if any. */
  private subStoreForLabel(label: string): Assets<unknown> | undefined {
    for (const [prefix, store] of this.subAssetStores) {
      if (label.startsWith(prefix)) return store;
    }
    return undefined;
  }

  /**
   * Start loading the asset at `path` and return its handle immediately. The
   * value is not present yet — `assets.get(handle)` is `undefined` until the
   * `PreUpdate` drain commits the completed load.
   *
   * Idempotent per path: a repeat `load` of the same path returns the same
   * handle and starts no new IO. Use {@link AssetServer.reload} to re-read.
   *
   * Throws synchronously if the path has no extension or no loader is
   * registered for it — both are wiring mistakes, surfaced before any handle is
   * handed out. The returned handle is typed `Handle<T>` on the caller's say-so
   * (the importer's output type is not checked against `T`).
   */
  load<T>(path: string): Handle<T> {
    const cached = this.pathToHandle.get(path);
    if (cached !== undefined) return cached.handle as Handle<T>;

    const ext = extensionOf(path);
    const loader = this.loaders.get(ext);
    if (loader === undefined) {
      throw new Error(
        `AssetServer.load: no loader registered for '.${ext}' (path '${path}'). Registered: ${this.registeredExtensions()}.`,
      );
    }

    const handle = loader.store.reserveHandle();
    this.pathToHandle.set(path, { handle, store: loader.store });
    this.kickLoad(path, loader.store, loader.importer, handle, handle.guid);
    return handle as Handle<T>;
  }

  /**
   * Re-read an already-loaded path into its existing handle. The fresh value
   * overwrites the slot on the next drain, queuing the store's `modified`
   * event so prepared GPU resources are rebuilt — the hot-reload path. Handles
   * stay stable across a reload. No-ops (with a dev advisory) if `path` was
   * never loaded.
   */
  reload(path: string): void {
    const cached = this.pathToHandle.get(path);
    if (cached === undefined) {
      this.logger.devWarn(`AssetServer.reload: '${path}' was never loaded; ignoring.`);
      return;
    }
    const loader = this.loaders.get(extensionOf(path));
    if (loader === undefined) {
      this.logger.devWarn(`AssetServer.reload: no loader for '${path}' anymore; ignoring.`);
      return;
    }
    this.kickLoad(path, cached.store, loader.importer, cached.handle, cached.handle.guid);
  }

  /**
   * Adopt `manifest` as the GUID→location index that {@link AssetServer.loadByGuid}
   * resolves against, replacing any already set. Use this when the manifest is
   * built or fetched out of band; {@link AssetServer.loadManifest} reads and
   * parses one through the injected source.
   */
  setManifest(manifest: AssetManifest): void {
    this.manifest = manifest;
  }

  /**
   * Read a manifest's bytes from `location` through the injected source, parse
   * them, and adopt the result for {@link AssetServer.loadByGuid}. Rejects if the
   * source read fails or the bytes are not a valid manifest.
   */
  async loadManifest(location: string): Promise<void> {
    const bytes = await this.source.read(location);
    this.manifest = parseAssetManifest(new TextDecoder().decode(bytes));
  }

  /**
   * Start loading the asset with persistent identity `guid` and return its
   * handle immediately — the GUID counterpart of {@link AssetServer.load}. The
   * handle carries the GUID, so once the `PreUpdate` drain commits the value its
   * store indexes it by GUID and a scene that references that GUID resolves with
   * no injected resolver.
   *
   * The GUID is resolved through the manifest (set via
   * {@link AssetServer.setManifest} or {@link AssetServer.loadManifest}) to a
   * location, then loaded exactly like {@link AssetServer.load} using the loader
   * registered for the location's extension. Idempotent per GUID: a repeat call
   * returns the same handle and starts no new IO.
   *
   * Throws synchronously if no manifest is set, the GUID is absent from it, the
   * location has no usable extension, or no loader is registered for that
   * extension — all wiring mistakes, surfaced before a handle is handed out.
   */
  loadByGuid<T>(guid: AssetGuid): Handle<T> {
    const cached = this.guidToHandle.get(guid);
    if (cached !== undefined) return cached.handle as Handle<T>;

    const sub = parseSubAssetGuid(guid);
    if (sub !== undefined) return this.loadSubAsset<T>(guid, sub.parent, sub.label);

    if (this.manifest === undefined) {
      throw new Error(`AssetServer.loadByGuid: no manifest set (guid '${guid}').`);
    }
    const entry = this.manifest.entries.get(guid);
    if (entry === undefined) {
      throw new Error(`AssetServer.loadByGuid: guid '${guid}' is not in the manifest.`);
    }

    // A kind loader wins when the manifest entry's kind has one (the
    // many-types-one-extension case, e.g. materials); otherwise fall back to the
    // location's extension loader.
    const ext = extensionOf(entry.location);
    const loader = this.kindLoaders.get(entry.kind) ?? this.loaders.get(ext);
    if (loader === undefined) {
      throw new Error(
        `AssetServer.loadByGuid: no loader registered for kind '${entry.kind}' or '.${ext}' (guid '${guid}', location '${entry.location}'). Registered: ${this.registeredExtensions()}.`,
      );
    }

    const handle = loader.store.reserveHandle(guid);
    this.guidToHandle.set(guid, { handle, store: loader.store });
    this.kickLoad(entry.location, loader.store, loader.importer, handle, guid);
    return handle as Handle<T>;
  }

  /**
   * Resolve a sub-asset reference (`"<parentGuid>#<label>"`) to a handle. The
   * sub-asset lives in the store registered for its label prefix
   * ({@link AssetServer.registerSubAssetStore}). If the parent already loaded,
   * its sub-asset is in that store by GUID and resolves directly. Otherwise a
   * slot is reserved with the deterministic sub-GUID and the parent is loaded;
   * the parent's {@link LoadContext.addLabeledAsset} fills *this* slot, matched
   * by GUID, when its IO completes and drains.
   */
  private loadSubAsset<T>(guid: AssetGuid, parent: AssetGuid, label: string): Handle<T> {
    const store = this.subStoreForLabel(label);
    if (store === undefined) {
      throw new Error(
        `AssetServer.loadByGuid: no sub-asset store registered for label '${label}' (guid '${guid}'). Register one with registerSubAssetStore.`,
      );
    }
    const existing = store.handleByGuid(guid);
    if (existing !== undefined) {
      this.guidToHandle.set(guid, { handle: existing, store });
      return existing as Handle<T>;
    }
    const handle = store.reserveHandle(guid);
    this.guidToHandle.set(guid, { handle, store });
    // Idempotent: loads the parent if it is not already loading. Its labeled
    // sub-assets fill the reserved slots above by GUID on the next drain.
    this.loadByGuid(parent);
    return handle as Handle<T>;
  }

  /**
   * Whether this server can resolve `guid` — it is already loading/loaded, the
   * current manifest maps it to a location, or it is a sub-asset reference whose
   * container is resolvable. Lets the scene loader prefer load-on-demand for
   * manifest-backed GUIDs and fall back to in-store resolution for assets added
   * directly (no manifest).
   */
  hasGuid(guid: AssetGuid): boolean {
    if (this.guidToHandle.has(guid)) return true;
    const sub = parseSubAssetGuid(guid);
    if (sub !== undefined) {
      return this.guidToHandle.has(sub.parent) || (this.manifest?.entries.has(sub.parent) ?? false);
    }
    return this.manifest?.entries.has(guid) ?? false;
  }

  /**
   * Drop the asset behind `guid` from its store and forget its handle, so a later
   * {@link AssetServer.loadByGuid} re-reads it. Removing the value queues the
   * store's `removed` event, releasing any prepared GPU resources. No-op if the
   * GUID was never loaded. Used by scene swapping to release assets the outgoing
   * scene held that the incoming one does not reference.
   */
  unloadByGuid(guid: AssetGuid): void {
    const cached = this.guidToHandle.get(guid);
    if (cached === undefined) return;
    cached.store.remove(cached.handle);
    this.guidToHandle.delete(guid);
  }

  /** Take and clear the completed-load queue. Called by the drain each frame. */
  drainCompleted(): CompletedLoad[] {
    const out = this.completed;
    this.completed = [];
    return out;
  }

  /** Take and clear the recorded load failures. */
  drainFailures(): AssetLoadFailure[] {
    const out = this.failures;
    this.failures = [];
    return out;
  }

  /** Number of loads whose IO is still in flight. */
  get pendingCount(): number {
    return this.inflight.size;
  }

  /**
   * Resolve once every in-flight load has settled (succeeded or failed). This
   * is **not** the load API — `load` is synchronous — but a convenience for
   * tests and loading screens. The completed values are queued, not yet in
   * their stores: a drain (a `PreUpdate` frame) still has to run.
   */
  async settle(): Promise<void> {
    while (this.inflight.size > 0) {
      await Promise.all(this.inflight);
    }
  }

  /** The registered loader extensions formatted for a "no loader" error. */
  private registeredExtensions(): string {
    const known = [...this.loaders.keys()].map((e) => `.${e}`).join(', ');
    return known === '' ? '(none)' : known;
  }

  private kickLoad(
    path: string,
    store: Assets<unknown>,
    importer: AssetImporter<unknown>,
    handle: Handle<unknown>,
    parentGuid: AssetGuid | undefined,
  ): void {
    const done = this.runLoad(path, store, importer, handle, parentGuid);
    this.inflight.add(done);
    // `runLoad` never rejects (it captures its own errors), so this always runs.
    void done.then(() => {
      this.inflight.delete(done);
    });
  }

  private async runLoad(
    path: string,
    store: Assets<unknown>,
    importer: AssetImporter<unknown>,
    handle: Handle<unknown>,
    parentGuid: AssetGuid | undefined,
  ): Promise<void> {
    // Sub-assets the importer registers are buffered here, local to this load,
    // so a throwing importer commits nothing: the buffer is dropped and the
    // reserved slots are simply never filled (all-or-nothing).
    const labeled: CompletedLoad[] = [];
    try {
      const bytes = await this.source.read(path);
      const ctx: LoadContext = {
        path,
        read: (relativePath) =>
          isDataUri(relativePath)
            ? Promise.resolve(decodeDataUri(relativePath))
            : this.source.read(resolveSiblingPath(path, relativePath)),
        addLabeledAsset: <U>(label: string, value: U, subStore: Assets<U>): Handle<U> => {
          // With a parent GUID, the sub-asset gets a deterministic, persistent
          // identity (`"<parent>#<label>"`) so a saved reference resolves on
          // reload. Reuse a slot already reserved by `loadByGuid` for that
          // sub-ref (so the handle a caller is holding is the one that gets
          // filled); otherwise reserve fresh and index it by GUID.
          if (parentGuid !== undefined) {
            const subGuid = subAssetGuid(parentGuid, label);
            const reserved = this.guidToHandle.get(subGuid);
            const subHandle =
              reserved !== undefined && reserved.store === (subStore as Assets<unknown>)
                ? (reserved.handle as Handle<U>)
                : subStore.reserveHandle(subGuid);
            if (reserved === undefined) {
              this.guidToHandle.set(subGuid, {
                handle: subHandle as Handle<unknown>,
                store: subStore as Assets<unknown>,
              });
            }
            labeled.push({ store: subStore as Assets<unknown>, handle: subHandle, value });
            return subHandle;
          }
          const subHandle = subStore.reserveHandle();
          labeled.push({ store: subStore as Assets<unknown>, handle: subHandle, value });
          return subHandle;
        },
      };
      const value = await importer(bytes, ctx);
      // Push the whole subgraph in one go — sub-assets before the root — so the
      // drain commits it in a single PreUpdate pass, queuing every `added` event
      // in the same frame, before extraction reads any of them.
      this.completed.push(...labeled, { store, handle, value });
    } catch (error) {
      this.failures.push({ path, handle, error });
    }
  }
}
