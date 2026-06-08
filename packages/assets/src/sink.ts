/**
 * The write counterpart of an {@link AssetSource}: persists a named byte payload
 * to the backing store. One method, mirroring `AssetSource.read` — a project is
 * written by looping over its files and `write`-ing each. Concrete sinks (an
 * HTTP-POST dev sink, a File System Access sink, a native disk sink) implement
 * this; the serialization layer never writes bytes itself, it hands them here.
 */
export interface AssetSink {
  /** Write `bytes` to `location`, rejecting if it cannot be written. */
  write(location: string, bytes: Uint8Array): Promise<void>;
}
