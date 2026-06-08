import type { AssetSink, AssetSource } from '@retro-engine/assets';

/**
 * An in-memory {@link AssetSink} that records each written file in a map. Pairs
 * with {@link MemoryAssetSource} for a no-I/O save→load round-trip in tests, and
 * stands in anywhere a real backend is not wanted.
 */
export class MemoryAssetSink implements AssetSink {
  /** Every written file, by location. Plug into {@link MemoryAssetSource} to read them back. */
  readonly files = new Map<string, Uint8Array>();

  write(location: string, bytes: Uint8Array): Promise<void> {
    this.files.set(location, bytes);
    return Promise.resolve();
  }
}

/**
 * An in-memory {@link AssetSource} reading from a location→bytes map — typically a
 * {@link MemoryAssetSink}'s `files`. The read mirror that closes the loop on an
 * in-process save→load round-trip.
 */
export class MemoryAssetSource implements AssetSource {
  constructor(private readonly files: ReadonlyMap<string, Uint8Array>) {}

  read(location: string): Promise<Uint8Array> {
    const bytes = this.files.get(location);
    return bytes === undefined
      ? Promise.reject(new Error(`MemoryAssetSource: no file at '${location}'.`))
      : Promise.resolve(bytes);
  }
}
