import type { AssetManifest, AssetSource } from '@retro-engine/assets';
import type { RangeFetch } from '@retro-engine/build/rpak';
import { RangeRpakReader } from '@retro-engine/build/rpak';

/**
 * Build a {@link RangeFetch} that reads a byte range of `url` over HTTP with a
 * `Range` request. Robust to a server that ignores the range and returns the
 * whole body (`200`): it slices locally in that case.
 */
export const httpRangeFetch = (url: string): RangeFetch => async (start, end) => {
  const response = await fetch(url, { headers: { Range: `bytes=${start}-${end - 1}` } });
  if (!response.ok && response.status !== 206) {
    throw new Error(`rpak fetch: ${url} returned ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  // A 206 gives exactly the requested slice; a 200 (range ignored) gives the
  // whole file, so slice it to the requested window.
  return response.status === 206 ? bytes : bytes.subarray(start, end);
};

/**
 * An {@link AssetSource} that reads a project's assets from a `.rpak` archive by
 * GUID, resolving the `AssetServer`'s location-based `read` through the project
 * manifest (location → GUID). The archive is opened lazily on the first read
 * (one header + TOC fetch), then each read pulls only that entry's byte range.
 *
 * This is the web runtime's asset backend: paired with a manifest fetched at
 * boot, it lets an exported game stream its packed assets over HTTP Range.
 */
export class RpakAssetSource implements AssetSource {
  readonly #reader: RangeRpakReader;
  readonly #locationToGuid: Map<string, string>;
  #opened: Promise<void> | undefined;

  constructor(reader: RangeRpakReader, manifest: AssetManifest) {
    this.#reader = reader;
    this.#locationToGuid = new Map();
    for (const entry of manifest.entries.values()) this.#locationToGuid.set(entry.location, entry.guid);
  }

  async read(location: string): Promise<Uint8Array> {
    this.#opened ??= this.#reader.open();
    await this.#opened;
    const guid = this.#locationToGuid.get(location);
    if (guid === undefined) {
      throw new Error(`rpak asset source: no packed asset for location '${location}'`);
    }
    return this.#reader.read(guid);
  }
}
