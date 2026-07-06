import { gzip } from './rpak-compression';
import { fnv1aHex } from './rpak-hash';
import {
  blobRegionStart,
  encodeHeader,
  type RpakCodec,
  type RpakEntry,
  type RpakToc,
  RPAK_VERSION,
} from './rpak-format';

/** One asset to pack into a `.rpak` archive. */
export interface RpakInput {
  /** Persistent asset GUID. Must be unique within the archive. */
  readonly guid: string;
  /** Raw (uncompressed) asset bytes. */
  readonly data: Uint8Array;
  /** Compression codec to apply. Defaults to `'none'`. */
  readonly codec?: RpakCodec;
}

/**
 * Pack `inputs` into a single `.rpak` archive (magic + version header → JSON
 * table of contents → concatenated per-entry blobs). Each entry is compressed
 * per its {@link RpakInput.codec} and fingerprinted (FNV-1a over the raw bytes)
 * for integrity. Throws on a duplicate GUID.
 */
export const writeRpak = async (inputs: readonly RpakInput[]): Promise<Uint8Array> => {
  const seen = new Set<string>();
  const blobs: Uint8Array[] = [];
  const entries: RpakEntry[] = [];
  let offset = 0;

  for (const input of inputs) {
    if (seen.has(input.guid)) {
      throw new Error(`writeRpak: duplicate GUID '${input.guid}'`);
    }
    seen.add(input.guid);

    const codec: RpakCodec = input.codec ?? 'none';
    const blob = codec === 'gzip' ? await gzip(input.data) : input.data;
    blobs.push(blob);
    entries.push({
      guid: input.guid,
      offset,
      length: blob.length,
      codec,
      uncompressedLength: input.data.length,
      hash: fnv1aHex(input.data),
    });
    offset += blob.length;
  }

  const toc: RpakToc = { version: RPAK_VERSION, entries };
  const tocBytes = new TextEncoder().encode(JSON.stringify(toc));
  const header = encodeHeader(tocBytes.length);

  const total = blobRegionStart(tocBytes.length) + offset;
  const out = new Uint8Array(total);
  out.set(header, 0);
  out.set(tocBytes, header.length);
  let cursor = blobRegionStart(tocBytes.length);
  for (const blob of blobs) {
    out.set(blob, cursor);
    cursor += blob.length;
  }
  return out;
};
