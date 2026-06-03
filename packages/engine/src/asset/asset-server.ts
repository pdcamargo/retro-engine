import type {
  AssetGuid,
  AssetImporter,
  AssetManifest,
  AssetSource,
  Assets,
  Handle,
  LoadContext,
} from '@retro-engine/assets';
import { parseAssetManifest } from '@retro-engine/assets';

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
    this.kickLoad(path, loader.store, loader.importer, handle);
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
    this.kickLoad(path, cached.store, loader.importer, cached.handle);
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

    if (this.manifest === undefined) {
      throw new Error(`AssetServer.loadByGuid: no manifest set (guid '${guid}').`);
    }
    const entry = this.manifest.entries.get(guid);
    if (entry === undefined) {
      throw new Error(`AssetServer.loadByGuid: guid '${guid}' is not in the manifest.`);
    }

    const ext = extensionOf(entry.location);
    const loader = this.loaders.get(ext);
    if (loader === undefined) {
      throw new Error(
        `AssetServer.loadByGuid: no loader registered for '.${ext}' (guid '${guid}', location '${entry.location}'). Registered: ${this.registeredExtensions()}.`,
      );
    }

    const handle = loader.store.reserveHandle(guid);
    this.guidToHandle.set(guid, { handle, store: loader.store });
    this.kickLoad(entry.location, loader.store, loader.importer, handle);
    return handle as Handle<T>;
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
  ): void {
    const done = this.runLoad(path, store, importer, handle);
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
        addLabeledAsset: <U>(_label: string, value: U, subStore: Assets<U>): Handle<U> => {
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
