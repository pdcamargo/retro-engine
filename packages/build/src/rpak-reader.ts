import { gunzip } from './rpak-compression';
import { fnv1aHex } from './rpak-hash';
import {
  blobRegionStart,
  decodeHeader,
  decodeToc,
  type RpakEntry,
  RPAK_HEADER_SIZE,
} from './rpak-format';

/** Decode + integrity-check one entry's stored blob into its raw bytes. */
const decodeBlob = async (entry: RpakEntry, blob: Uint8Array): Promise<Uint8Array> => {
  const data = entry.codec === 'gzip' ? await gunzip(blob) : blob;
  if (data.length !== entry.uncompressedLength) {
    throw new Error(
      `rpak: length mismatch for '${entry.guid}' (${data.length} != ${entry.uncompressedLength})`,
    );
  }
  const hash = fnv1aHex(data);
  if (hash !== entry.hash) {
    throw new Error(`rpak: integrity check failed for '${entry.guid}' (corrupt blob)`);
  }
  return data;
};

const indexEntries = (entries: readonly RpakEntry[]): Map<string, RpakEntry> =>
  new Map(entries.map((e) => [e.guid, e]));

/**
 * Reads assets from a fully-in-memory `.rpak` archive by GUID. Parses the header
 * + TOC once; each {@link read} slices the entry's blob, decompresses it, and
 * verifies its content hash.
 */
export class RpakReader {
  readonly #bytes: Uint8Array;
  readonly #blobStart: number;
  readonly #byGuid: Map<string, RpakEntry>;

  constructor(bytes: Uint8Array) {
    const { tocByteLength } = decodeHeader(bytes);
    const tocBytes = bytes.subarray(RPAK_HEADER_SIZE, RPAK_HEADER_SIZE + tocByteLength);
    this.#byGuid = indexEntries(decodeToc(tocBytes).entries);
    this.#blobStart = blobRegionStart(tocByteLength);
    this.#bytes = bytes;
  }

  /** Whether the archive contains an asset with this GUID. */
  has(guid: string): boolean {
    return this.#byGuid.has(guid);
  }

  /** Every GUID in the archive. */
  get guids(): string[] {
    return [...this.#byGuid.keys()];
  }

  /** Read, decompress, and verify the asset's raw bytes. Throws if absent/corrupt. */
  async read(guid: string): Promise<Uint8Array> {
    const entry = this.#byGuid.get(guid);
    if (entry === undefined) throw new Error(`rpak: no asset '${guid}' in archive`);
    const start = this.#blobStart + entry.offset;
    return decodeBlob(entry, this.#bytes.subarray(start, start + entry.length));
  }
}

/**
 * Fetches a half-open byte range `[start, end)` of a `.rpak` resource. The web
 * runtime injects an implementation backed by an HTTP `Range` request; tests
 * inject one that slices an in-memory buffer.
 */
export type RangeFetch = (start: number, end: number) => Promise<Uint8Array>;

/**
 * Reads assets from a remote `.rpak` archive without downloading the whole file:
 * {@link open} fetches only the header + table of contents, and each
 * {@link read} fetches only the requested entry's byte range. Backs lazy,
 * GUID-addressed asset streaming over HTTP Range.
 */
export class RangeRpakReader {
  readonly #fetch: RangeFetch;
  #blobStart: number | undefined;
  #byGuid: Map<string, RpakEntry> | undefined;

  constructor(fetch: RangeFetch) {
    this.#fetch = fetch;
  }

  /** Fetch + parse the header and TOC. Must be called before {@link read}/{@link has}. */
  async open(): Promise<void> {
    const header = await this.#fetch(0, RPAK_HEADER_SIZE);
    const { tocByteLength } = decodeHeader(header);
    const tocBytes = await this.#fetch(RPAK_HEADER_SIZE, RPAK_HEADER_SIZE + tocByteLength);
    this.#byGuid = indexEntries(decodeToc(tocBytes).entries);
    this.#blobStart = blobRegionStart(tocByteLength);
  }

  /** Whether the (opened) archive contains this GUID. */
  has(guid: string): boolean {
    return this.#byGuid?.has(guid) ?? false;
  }

  /** Fetch only this asset's byte range, decompress, and verify it. */
  async read(guid: string): Promise<Uint8Array> {
    if (this.#byGuid === undefined || this.#blobStart === undefined) {
      throw new Error('rpak: call open() before read()');
    }
    const entry = this.#byGuid.get(guid);
    if (entry === undefined) throw new Error(`rpak: no asset '${guid}' in archive`);
    const start = this.#blobStart + entry.offset;
    return decodeBlob(entry, await this.#fetch(start, start + entry.length));
  }
}
