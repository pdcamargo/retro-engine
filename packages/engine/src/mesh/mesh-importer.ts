import type { AssetImporter, AssetSerializer } from '@retro-engine/assets';
import type { PrimitiveTopology, VertexFormat } from '@retro-engine/renderer-core';

import { u16Indices, u32Indices } from './indices';
import { Mesh, type MeshAttributeData } from './mesh';
import { meshVertexAttribute } from './vertex-attribute';

/** Current `.rmesh` wire-format version. Bumped only on a breaking shape change. */
export const MESH_FORMAT_VERSION = 1;

/** Tags which typed array an attribute's data reconstructs into. */
type ElementType = 'f32' | 'u32' | 'i32' | 'u16' | 'u8';

interface SerializedMeshAttribute {
  /** Well-known attribute id (POSITION = 0, NORMAL = 1, …). */
  readonly id: number;
  /** Human-readable attribute name, for diagnostics / glTF parity. */
  readonly name: string;
  /** Per-vertex byte format. */
  readonly format: VertexFormat;
  /** Which typed array `data` came from. */
  readonly elementType: ElementType;
  /** The packed values as a plain numeric array — lossless for f32 and the integer widths, and JSON-native. */
  readonly data: readonly number[];
}

/**
 * The on-the-wire shape of an `.rmesh` file: a UTF-8 JSON envelope of the mesh's
 * attributes (in insertion order), optional indices, and topology. v1 stores
 * values as numeric arrays rather than a packed binary blob — simplest thing that
 * round-trips losslessly and stays browser-safe; a compact binary form is a later
 * concern.
 */
interface MeshFile {
  readonly version: number;
  readonly label?: string;
  readonly primitiveTopology: PrimitiveTopology;
  readonly attributes: readonly SerializedMeshAttribute[];
  readonly indices?: { readonly kind: 'u16' | 'u32'; readonly data: readonly number[] };
}

const elementTypeOf = (data: MeshAttributeData['data']): ElementType => {
  if (data instanceof Float32Array) return 'f32';
  if (data instanceof Uint32Array) return 'u32';
  if (data instanceof Int32Array) return 'i32';
  if (data instanceof Uint16Array) return 'u16';
  return 'u8'; // Uint8Array — the only remaining arm of MeshAttributeData['data'].
};

const decodeElement = (elementType: ElementType, data: readonly number[]): MeshAttributeData['data'] => {
  switch (elementType) {
    case 'f32':
      return new Float32Array(data);
    case 'u32':
      return new Uint32Array(data);
    case 'i32':
      return new Int32Array(data);
    case 'u16':
      return new Uint16Array(data);
    case 'u8':
      return new Uint8Array(data);
    default:
      throw new Error(`Mesh: unknown attribute elementType '${String(elementType)}'`);
  }
};

const encodeMesh = (mesh: Mesh): Uint8Array => {
  const attributes: SerializedMeshAttribute[] = [];
  // iterAttributes preserves insertion order, which is POSITION/NORMAL/UV-first
  // by builder convention; the importer re-inserts in this same order.
  for (const { attribute, data } of mesh.iterAttributes()) {
    attributes.push({
      id: attribute.id,
      name: attribute.name,
      format: attribute.format,
      elementType: elementTypeOf(data),
      data: Array.from(data),
    });
  }
  const file: MeshFile = {
    version: MESH_FORMAT_VERSION,
    ...(mesh.label !== undefined ? { label: mesh.label } : {}),
    primitiveTopology: mesh.primitiveTopology,
    attributes,
    ...(mesh.indices !== undefined
      ? { indices: { kind: mesh.indices.kind, data: Array.from(mesh.indices.data) } }
      : {}),
  };
  return new TextEncoder().encode(JSON.stringify(file));
};

const validateMeshFile = (raw: unknown): MeshFile => {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Mesh: payload is not a JSON object');
  }
  const data = raw as Partial<MeshFile>;
  if (data.version !== MESH_FORMAT_VERSION) {
    throw new Error(
      `Mesh: unsupported format version ${String(data.version)} (expected ${MESH_FORMAT_VERSION})`,
    );
  }
  if (typeof data.primitiveTopology !== 'string') {
    throw new Error('Mesh: payload is missing primitiveTopology');
  }
  if (!Array.isArray(data.attributes)) {
    throw new Error('Mesh: payload is missing an attributes array');
  }
  return data as MeshFile;
};

const decodeMesh = (bytes: Uint8Array): Mesh => {
  const file = validateMeshFile(JSON.parse(new TextDecoder().decode(bytes)));
  const mesh = new Mesh(
    file.label !== undefined
      ? { label: file.label, primitiveTopology: file.primitiveTopology }
      : { primitiveTopology: file.primitiveTopology },
  );
  for (const attr of file.attributes) {
    mesh.insertAttribute(
      meshVertexAttribute(attr.name, attr.id, attr.format),
      decodeElement(attr.elementType, attr.data),
    );
  }
  if (file.indices !== undefined) {
    mesh.setIndices(
      file.indices.kind === 'u16' ? u16Indices(file.indices.data) : u32Indices(file.indices.data),
    );
  }
  return mesh;
};

/**
 * Build the {@link AssetImporter} that turns `.rmesh` bytes (UTF-8 JSON) into a
 * {@link Mesh}. Synchronous — an `.rmesh` is self-contained, with no external
 * buffers to resolve through the load context.
 */
export const createMeshImporter = (): AssetImporter<Mesh> => (bytes) => decodeMesh(bytes);

/**
 * Build the {@link AssetSerializer} that round-trips a {@link Mesh} through its
 * canonical `.rmesh` JSON form. The inverse of {@link createMeshImporter}; lets
 * the project-save layer promote an in-memory mesh to a project asset.
 */
export const createMeshSerializer = (): AssetSerializer<Mesh> => ({
  serialize: (mesh) => encodeMesh(mesh),
  deserialize: (bytes) => decodeMesh(bytes),
});
