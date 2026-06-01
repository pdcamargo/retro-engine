/**
 * Context handed to an {@link AssetImporter} when it turns raw bytes into a
 * decoded asset value. Carries the originating path so an importer can resolve
 * sibling resources or report errors against a real location.
 */
export interface AssetImportContext {
  /** The location the bytes were read from (loose-file path or bundle entry). */
  readonly path: string;
}

/**
 * Decodes raw bytes into an asset value of type `T`. An importer is a plain
 * function, sync or async — a new asset type is supported by registering one,
 * never by extending a base importer.
 */
export type AssetImporter<T> = (bytes: Uint8Array, ctx: AssetImportContext) => T | Promise<T>;

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
