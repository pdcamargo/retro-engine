import { GltfImportError } from './gltf-error';

/** ASCII `glTF` as a little-endian `uint32` — the GLB file magic. */
const GLB_MAGIC = 0x46546c67;
/** ASCII `JSON` as a little-endian `uint32` — the JSON chunk type. */
const CHUNK_TYPE_JSON = 0x4e4f534a;
/** ASCII `BIN\0` as a little-endian `uint32` — the binary chunk type. */
const CHUNK_TYPE_BIN = 0x004e4942;

const HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;

/**
 * The two chunks a GLB container carries: the glTF JSON, and the optional binary
 * buffer holding geometry and/or images. Both are zero-copy views into the
 * original bytes.
 */
export interface GlbContainer {
  /** The raw bytes of the JSON chunk (may include trailing space padding). */
  readonly json: Uint8Array;
  /** The binary chunk, if present. */
  readonly bin?: Uint8Array;
}

const viewOf = (bytes: Uint8Array): DataView =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/** Whether `bytes` begin with the GLB magic and so are a binary glTF container. */
export const isGlb = (bytes: Uint8Array): boolean =>
  bytes.byteLength >= 4 && viewOf(bytes).getUint32(0, true) === GLB_MAGIC;

/**
 * Read a GLB binary container: validate the 12-byte header (magic, version `2`,
 * total length) and walk its chunks (JSON first, optional BIN second). Unknown
 * trailing chunks are ignored, per spec. Throws {@link GltfImportError} on a bad
 * magic, an unsupported version, or a truncated / malformed chunk layout.
 */
export const readGlb = (bytes: Uint8Array): GlbContainer => {
  if (bytes.byteLength < HEADER_BYTES) {
    throw new GltfImportError('malformed-glb', `GLB is shorter than its 12-byte header (${bytes.byteLength} bytes).`);
  }
  const header = viewOf(bytes);
  if (header.getUint32(0, true) !== GLB_MAGIC) {
    throw new GltfImportError('bad-magic', 'Not a GLB file: magic does not match `glTF`.');
  }
  const version = header.getUint32(4, true);
  if (version !== 2) {
    throw new GltfImportError('bad-version', `Unsupported GLB container version ${version}; only version 2 is supported.`);
  }

  const declaredLength = header.getUint32(8, true);
  const end = Math.min(declaredLength, bytes.byteLength);

  let json: Uint8Array | undefined;
  let bin: Uint8Array | undefined;
  let offset = HEADER_BYTES;
  let chunkIndex = 0;

  while (offset + CHUNK_HEADER_BYTES <= end) {
    const chunkLength = header.getUint32(offset, true);
    const chunkType = header.getUint32(offset + 4, true);
    const dataStart = offset + CHUNK_HEADER_BYTES;
    const dataEnd = dataStart + chunkLength;
    if (dataEnd > bytes.byteLength) {
      throw new GltfImportError('malformed-glb', `GLB chunk ${chunkIndex} (length ${chunkLength}) overruns the file.`);
    }

    if (chunkIndex === 0 && chunkType !== CHUNK_TYPE_JSON) {
      throw new GltfImportError('malformed-glb', 'GLB first chunk is not a JSON chunk.');
    }
    if (chunkType === CHUNK_TYPE_JSON && json === undefined) {
      json = bytes.subarray(dataStart, dataEnd);
    } else if (chunkType === CHUNK_TYPE_BIN && bin === undefined) {
      bin = bytes.subarray(dataStart, dataEnd);
    }
    // Any further or unknown chunk types are skipped.

    offset = dataEnd;
    chunkIndex += 1;
  }

  if (json === undefined) {
    throw new GltfImportError('malformed-glb', 'GLB has no JSON chunk.');
  }
  return bin === undefined ? { json } : { json, bin };
};
