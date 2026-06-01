import { GltfImportError } from './gltf-error';
import type { GltfAccessor, GltfComponentType, GltfDocument } from './schema';

/** Typed array a decoded accessor can produce, matching its component type. */
export type DecodedAccessorArray =
  | Int8Array
  | Uint8Array
  | Int16Array
  | Uint16Array
  | Uint32Array
  | Float32Array;

/**
 * A fully decoded accessor: a flat typed array of `count × componentCount`
 * values, in element order. Normalized integer accessors are expanded to a
 * `Float32Array`; other accessors keep the array type of their component type.
 * Mapping these onto engine vertex attributes happens in a later layer.
 */
export interface DecodedAccessor {
  /** Flat values, `count × componentCount` long, in element order. */
  readonly array: DecodedAccessorArray;
  /** Components per element (1 for SCALAR, 3 for VEC3, 16 for MAT4, …). */
  readonly componentCount: number;
  /** Number of elements. */
  readonly count: number;
  /** Whether values were expanded from normalized integers to floats. */
  readonly normalized: boolean;
}

const componentByteSize = (componentType: number): number => {
  switch (componentType) {
    case 5120:
    case 5121:
      return 1;
    case 5122:
    case 5123:
      return 2;
    case 5125:
    case 5126:
      return 4;
    default:
      throw new GltfImportError('invalid-accessor', `Unknown accessor componentType ${componentType}.`);
  }
};

const componentCountOf = (type: string): number => {
  switch (type) {
    case 'SCALAR':
      return 1;
    case 'VEC2':
      return 2;
    case 'VEC3':
      return 3;
    case 'VEC4':
    case 'MAT2':
      return 4;
    case 'MAT3':
      return 9;
    case 'MAT4':
      return 16;
    default:
      throw new GltfImportError('invalid-accessor', `Unknown accessor type '${type}'.`);
  }
};

const readComponent = (view: DataView, byteOffset: number, componentType: number): number => {
  switch (componentType) {
    case 5120:
      return view.getInt8(byteOffset);
    case 5121:
      return view.getUint8(byteOffset);
    case 5122:
      return view.getInt16(byteOffset, true);
    case 5123:
      return view.getUint16(byteOffset, true);
    case 5125:
      return view.getUint32(byteOffset, true);
    case 5126:
      return view.getFloat32(byteOffset, true);
    default:
      throw new GltfImportError('invalid-accessor', `Unknown accessor componentType ${componentType}.`);
  }
};

/** Expand a normalized integer to its float value per the glTF dequantization rules. */
const dequantize = (raw: number, componentType: number): number => {
  switch (componentType) {
    case 5121:
      return raw / 255;
    case 5123:
      return raw / 65535;
    case 5120:
      return Math.max(raw / 127, -1);
    case 5122:
      return Math.max(raw / 32767, -1);
    default:
      // FLOAT / UNSIGNED_INT are not validly normalized; pass through.
      return raw;
  }
};

const makeOutput = (
  componentType: GltfComponentType,
  normalized: boolean,
  length: number,
): DecodedAccessorArray => {
  if (normalized || componentType === 5126) return new Float32Array(length);
  switch (componentType) {
    case 5120:
      return new Int8Array(length);
    case 5121:
      return new Uint8Array(length);
    case 5122:
      return new Int16Array(length);
    case 5123:
      return new Uint16Array(length);
    case 5125:
      return new Uint32Array(length);
    default:
      throw new GltfImportError('invalid-accessor', `Unknown accessor componentType ${componentType}.`);
  }
};

const viewOf = (bytes: Uint8Array): DataView =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

const bufferForView = (
  document: GltfDocument,
  buffers: readonly Uint8Array[],
  bufferViewIndex: number,
): { bytes: Uint8Array; byteOffset: number; byteStride?: number } => {
  const view = document.bufferViews?.[bufferViewIndex];
  if (view === undefined) {
    throw new GltfImportError('missing-resource', `bufferView ${bufferViewIndex} does not exist.`);
  }
  const bytes = buffers[view.buffer];
  if (bytes === undefined) {
    throw new GltfImportError('missing-resource', `bufferView ${bufferViewIndex} references missing buffer ${view.buffer}.`);
  }
  return view.byteStride === undefined
    ? { bytes, byteOffset: view.byteOffset ?? 0 }
    : { bytes, byteOffset: view.byteOffset ?? 0, byteStride: view.byteStride };
};

const readBase = (
  out: DecodedAccessorArray,
  document: GltfDocument,
  buffers: readonly Uint8Array[],
  accessor: GltfAccessor,
  componentCount: number,
): void => {
  if (accessor.bufferView === undefined) return; // zero-initialized; only valid with sparse
  const { bytes, byteOffset, byteStride } = bufferForView(document, buffers, accessor.bufferView);
  const compSize = componentByteSize(accessor.componentType);
  const elementSize = compSize * componentCount;
  const stride = byteStride ?? elementSize;
  const base = byteOffset + (accessor.byteOffset ?? 0);
  const { count } = accessor;
  if (count > 0) {
    const lastByte = base + stride * (count - 1) + elementSize;
    if (lastByte > bytes.byteLength) {
      throw new GltfImportError('out-of-bounds', `Accessor reads ${lastByte} bytes from a ${bytes.byteLength}-byte buffer.`);
    }
  }
  const view = viewOf(bytes);
  const normalized = accessor.normalized === true;
  for (let i = 0; i < count; i += 1) {
    const elementStart = base + i * stride;
    for (let c = 0; c < componentCount; c += 1) {
      const raw = readComponent(view, elementStart + c * compSize, accessor.componentType);
      out[i * componentCount + c] = normalized ? dequantize(raw, accessor.componentType) : raw;
    }
  }
};

const applySparse = (
  out: DecodedAccessorArray,
  document: GltfDocument,
  buffers: readonly Uint8Array[],
  accessor: GltfAccessor,
  componentCount: number,
): void => {
  const sparse = accessor.sparse;
  if (sparse === undefined) return;

  const idx = bufferForView(document, buffers, sparse.indices.bufferView);
  const idxCompSize = componentByteSize(sparse.indices.componentType);
  const idxBase = idx.byteOffset + (sparse.indices.byteOffset ?? 0);
  const idxView = viewOf(idx.bytes);
  if (idxBase + sparse.count * idxCompSize > idx.bytes.byteLength) {
    throw new GltfImportError('out-of-bounds', 'Sparse accessor index data overruns its buffer.');
  }

  const val = bufferForView(document, buffers, sparse.values.bufferView);
  const compSize = componentByteSize(accessor.componentType);
  const valBase = val.byteOffset + (sparse.values.byteOffset ?? 0);
  const valView = viewOf(val.bytes);
  if (valBase + sparse.count * componentCount * compSize > val.bytes.byteLength) {
    throw new GltfImportError('out-of-bounds', 'Sparse accessor value data overruns its buffer.');
  }

  const normalized = accessor.normalized === true;
  for (let s = 0; s < sparse.count; s += 1) {
    const target = readComponent(idxView, idxBase + s * idxCompSize, sparse.indices.componentType);
    if (target < 0 || target >= accessor.count) {
      throw new GltfImportError('out-of-bounds', `Sparse accessor index ${target} is outside the accessor's ${accessor.count} elements.`);
    }
    for (let c = 0; c < componentCount; c += 1) {
      const raw = readComponent(valView, valBase + (s * componentCount + c) * compSize, accessor.componentType);
      out[target * componentCount + c] = normalized ? dequantize(raw, accessor.componentType) : raw;
    }
  }
};

/**
 * Decode the accessor at `accessorIndex` into a flat typed array. Reads every
 * component type, honors `byteOffset` and `byteStride` (interleaved layouts),
 * expands normalized integers to floats, and reconstructs sparse accessors by
 * overlaying their replacement values onto the base (or zero-filled) data.
 * Throws {@link GltfImportError} if the accessor is missing, declares an unknown
 * component type or type, or reads past its buffer.
 */
export const decodeAccessor = (
  document: GltfDocument,
  buffers: readonly Uint8Array[],
  accessorIndex: number,
): DecodedAccessor => {
  const accessor = document.accessors?.[accessorIndex];
  if (accessor === undefined) {
    throw new GltfImportError('missing-resource', `accessor ${accessorIndex} does not exist.`);
  }
  const componentCount = componentCountOf(accessor.type);
  const normalized = accessor.normalized === true;
  const out = makeOutput(accessor.componentType, normalized, accessor.count * componentCount);

  readBase(out, document, buffers, accessor, componentCount);
  applySparse(out, document, buffers, accessor, componentCount);

  return { array: out, componentCount, count: accessor.count, normalized };
};
