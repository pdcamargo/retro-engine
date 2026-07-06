/** Compression applied to a `.rpak` entry's blob. */
export type RpakCodec = 'none' | 'gzip';

/** The four ASCII bytes every `.rpak` file starts with: `RPAK`. */
export const RPAK_MAGIC = 0x5250414b; // 'R','P','A','K' read as a big-endian u32
export const RPAK_MAGIC_BYTES = new Uint8Array([0x52, 0x50, 0x41, 0x4b]);

/** Current `.rpak` format version. */
export const RPAK_VERSION = 1 as const;

/** Fixed header size: magic(4) + version(4) + tocLength(4). */
export const RPAK_HEADER_SIZE = 12 as const;

/** One asset's location + metadata within a `.rpak` archive. */
export interface RpakEntry {
  /** Persistent asset GUID this blob belongs to. */
  readonly guid: string;
  /** Byte offset of the (possibly compressed) blob, relative to the blob region start. */
  readonly offset: number;
  /** Byte length of the stored (possibly compressed) blob. */
  readonly length: number;
  /** Compression codec applied to the blob. */
  readonly codec: RpakCodec;
  /** Decoded byte length (equals {@link length} for `codec: 'none'`). */
  readonly uncompressedLength: number;
  /** FNV-1a hash (hex) of the **uncompressed** bytes, for integrity checks. */
  readonly hash: string;
}

/** The parsed table of contents of a `.rpak` archive. */
export interface RpakToc {
  readonly version: number;
  readonly entries: readonly RpakEntry[];
}

/** Encode the fixed header for a TOC of `tocByteLength` bytes. */
export const encodeHeader = (tocByteLength: number): Uint8Array => {
  const header = new Uint8Array(RPAK_HEADER_SIZE);
  const view = new DataView(header.buffer);
  header.set(RPAK_MAGIC_BYTES, 0);
  view.setUint32(4, RPAK_VERSION, true);
  view.setUint32(8, tocByteLength, true);
  return header;
};

/**
 * Parse and validate a `.rpak` header from at least the first
 * {@link RPAK_HEADER_SIZE} bytes. Throws on a bad magic or unsupported version.
 * Returns the declared TOC byte length so a caller can read the TOC next.
 */
export const decodeHeader = (bytes: Uint8Array): { version: number; tocByteLength: number } => {
  if (bytes.length < RPAK_HEADER_SIZE) {
    throw new Error(`rpak: truncated header (${bytes.length} < ${RPAK_HEADER_SIZE} bytes)`);
  }
  for (let i = 0; i < 4; i++) {
    if (bytes[i] !== RPAK_MAGIC_BYTES[i]) {
      throw new Error('rpak: bad magic — not a .rpak archive');
    }
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(4, true);
  if (version !== RPAK_VERSION) {
    throw new Error(`rpak: unsupported version ${version} (this reader supports ${RPAK_VERSION})`);
  }
  const tocByteLength = view.getUint32(8, true);
  return { version, tocByteLength };
};

/** Absolute byte offset where the blob region begins for a given TOC length. */
export const blobRegionStart = (tocByteLength: number): number => RPAK_HEADER_SIZE + tocByteLength;

/** Parse the TOC JSON bytes into a validated {@link RpakToc}. */
export const decodeToc = (tocBytes: Uint8Array): RpakToc => {
  const raw = JSON.parse(new TextDecoder().decode(tocBytes)) as unknown;
  if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as RpakToc).entries)) {
    throw new Error('rpak: malformed table of contents');
  }
  return raw as RpakToc;
};
