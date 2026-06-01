import type { Assets } from './assets';
import type { Handle } from './handle';

/**
 * Context handed to an {@link AssetImporter} when it turns raw bytes into a
 * decoded asset value. Beyond the originating path, it lets an importer pull in
 * related resources and register the sub-assets a composite file decodes into —
 * the capability a multi-file format (a model with external buffers and images,
 * an atlas with a sidecar) needs.
 */
export interface LoadContext {
  /** The location the bytes were read from (loose-file path or bundle entry). */
  readonly path: string;
  /**
   * Read a resource referenced relative to this asset, resolved against the
   * directory of {@link path} and fetched through the same source the root load
   * used. `relativePath` is a plain relative location (e.g. `'mesh.bin'`,
   * `'textures/wood.png'`); a `data:` URI is decoded inline and never hits the
   * source. The importer awaits these reads as part of the value it returns, so
   * the asset is not considered loaded until its dependencies have resolved.
   */
  read(relativePath: string): Promise<Uint8Array>;
  /**
   * Register a decoded sub-asset into `store` and return its {@link Handle} so
   * the importer can wire it into the composite value it returns. `label` is a
   * human-meaningful identifier for the part (e.g. `'Mesh0'`), used for
   * diagnostics. The handle is reserved immediately; the value becomes visible
   * in `store` atomically with the composite root once the importer resolves,
   * and not at all if it throws.
   */
  addLabeledAsset<U>(label: string, value: U, store: Assets<U>): Handle<U>;
}

/**
 * Decodes raw bytes into an asset value of type `T`. An importer is a plain
 * function, sync or async — a new asset type is supported by registering one,
 * never by extending a base importer.
 */
export type AssetImporter<T> = (bytes: Uint8Array, ctx: LoadContext) => T | Promise<T>;

/**
 * Maps a file extension (or asset-kind tag) to its {@link AssetImporter}.
 * Importers register through a plugin at startup; the asset server looks one up
 * by extension when resolving a load.
 */
export interface AssetImporterRegistry {
  /** Register `importer` for `extension` (e.g. `'png'`, `'gltf'`). */
  register<T>(extension: string, importer: AssetImporter<T>): void;
  /** Look up the importer registered for `extension`, if any. */
  get<T>(extension: string): AssetImporter<T> | undefined;
}
