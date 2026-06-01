import type { Indices, MeshVertexAttribute } from '@retro-engine/engine';
import { Mesh, MeshAttribute, u16Indices, u32Indices } from '@retro-engine/engine';

import { decodeAccessor, type DecodedAccessorArray } from './accessor';
import { mapPrimitiveMode } from './topology';
import type { GltfDocument, GltfPrimitive } from './schema';

/**
 * glTF attribute semantic → engine vertex attribute. Semantics not listed here
 * are recognised as deferred: `TEXCOORD_1` (UV_1), `JOINTS_0`, and `WEIGHTS_0`
 * map to attributes the engine does not yet carry (skinning / second UV set) and
 * are skipped rather than treated as errors.
 */
const ATTRIBUTE_MAP: Readonly<Record<string, MeshVertexAttribute>> = {
  POSITION: MeshAttribute.POSITION,
  NORMAL: MeshAttribute.NORMAL,
  TEXCOORD_0: MeshAttribute.UV_0,
  TANGENT: MeshAttribute.TANGENT,
  COLOR_0: MeshAttribute.COLOR,
};

const toFloat32 = (array: DecodedAccessorArray): Float32Array =>
  array instanceof Float32Array ? array : new Float32Array(array);

/** Expand a VEC3 color stream to VEC4 by appending an opaque alpha of 1. */
const expandColorToVec4 = (rgb: Float32Array, count: number): Float32Array => {
  const rgba = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    rgba[i * 4] = rgb[i * 3] as number;
    rgba[i * 4 + 1] = rgb[i * 3 + 1] as number;
    rgba[i * 4 + 2] = rgb[i * 3 + 2] as number;
    rgba[i * 4 + 3] = 1;
  }
  return rgba;
};

const toIndices = (array: DecodedAccessorArray): Indices =>
  array instanceof Uint32Array ? u32Indices(array) : u16Indices(array);

/**
 * Maps one glTF primitive to an engine {@link Mesh}.
 *
 * Vertex attributes are mapped by semantic (POSITION / NORMAL / TEXCOORD_0 /
 * TANGENT / COLOR_0); a VEC3 COLOR_0 is expanded to VEC4. Provided TANGENT
 * (VEC4, `w` = handedness) is used as-is. Indices are promoted to `u16` from
 * `u8`, or kept as `u16` / `u32`. No coordinate or winding conversion is applied
 * — glTF and the engine share a right-handed, +Y-up, −Z-forward basis.
 *
 * @throws GltfImportError for an unsupported primitive mode (see {@link mapPrimitiveMode}).
 */
export const mapPrimitiveToMesh = (
  document: GltfDocument,
  buffers: readonly Uint8Array[],
  primitive: GltfPrimitive,
): Mesh => {
  const mesh = new Mesh({ primitiveTopology: mapPrimitiveMode(primitive.mode) });

  for (const [semantic, accessorIndex] of Object.entries(primitive.attributes)) {
    const attribute = ATTRIBUTE_MAP[semantic];
    if (attribute === undefined) continue;
    const decoded = decodeAccessor(document, buffers, accessorIndex);
    const data =
      semantic === 'COLOR_0' && decoded.componentCount === 3
        ? expandColorToVec4(toFloat32(decoded.array), decoded.count)
        : toFloat32(decoded.array);
    mesh.insertAttribute(attribute, data);
  }

  if (primitive.indices !== undefined) {
    mesh.setIndices(toIndices(decodeAccessor(document, buffers, primitive.indices).array));
  }

  return mesh;
};
