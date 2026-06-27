import type { Indices, MeshVertexAttribute, MorphTarget } from '@retro-engine/engine';
import { Mesh, MeshAttribute, MorphTargets, u16Indices, u32Indices } from '@retro-engine/engine';

import { decodeAccessor, type DecodedAccessorArray } from './accessor';
import { mapPrimitiveMode } from './topology';
import type { GltfDocument, GltfPrimitive } from './schema';

/**
 * glTF attribute semantic → engine vertex attribute, in a fixed slot order.
 *
 * Order matters: the vertex layout assigns each attribute a `shaderLocation`
 * from its slot index, and the engine's shaders expect position at location 0,
 * normal at 1, UV at 2, and — on a skinned mesh — joint indices at 3, joint
 * weights at 4. glTF lists a primitive's attributes in arbitrary key order (a
 * Blender export often puts `COLOR_0` first), so they are inserted in this
 * canonical order rather than the order the file happens to use. Joints/weights
 * sit ahead of `TANGENT`/`COLOR_0` so they keep locations 3/4 regardless of
 * whether the optional trailing attributes are present.
 *
 * `TEXCOORD_1` (UV_1) is still deferred — the engine carries no second UV set
 * yet, so it is skipped rather than treated as an error.
 */
const ORDERED_ATTRIBUTES: readonly (readonly [string, MeshVertexAttribute])[] = [
  ['POSITION', MeshAttribute.POSITION],
  ['NORMAL', MeshAttribute.NORMAL],
  ['TEXCOORD_0', MeshAttribute.UV_0],
  ['JOINTS_0', MeshAttribute.JOINT_INDEX],
  ['WEIGHTS_0', MeshAttribute.JOINT_WEIGHT],
  ['TANGENT', MeshAttribute.TANGENT],
  ['COLOR_0', MeshAttribute.COLOR],
];

const toFloat32 = (array: DecodedAccessorArray): Float32Array =>
  array instanceof Float32Array ? array : new Float32Array(array);

/**
 * Widen decoded joint indices to `Uint16Array` to match the `uint16x4`
 * {@link MeshAttribute.JOINT_INDEX} format. glTF stores `JOINTS_0` as
 * `UNSIGNED_BYTE` or `UNSIGNED_SHORT`; either decodes losslessly into 16 bits.
 */
const toUint16 = (array: DecodedAccessorArray): Uint16Array =>
  array instanceof Uint16Array ? array : new Uint16Array(array);

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
 * Morph targets (`primitive.targets`) are decoded into a {@link MorphTargets}
 * delta store on the mesh: POSITION and NORMAL deltas per target (NORMAL filled
 * with zeros when absent), named from `morph.targetNames` and seeded with
 * `morph.defaultWeights`. TANGENT deltas are ignored — this renderer reconstructs
 * the tangent frame from screen-space derivatives and consumes no per-vertex
 * tangent.
 *
 * @throws GltfImportError for an unsupported primitive mode (see {@link mapPrimitiveMode}).
 */
export const mapPrimitiveToMesh = (
  document: GltfDocument,
  buffers: readonly Uint8Array[],
  primitive: GltfPrimitive,
  morph?: {
    targetNames?: readonly string[] | undefined;
    defaultWeights?: readonly number[] | undefined;
  },
): Mesh => {
  const mesh = new Mesh({ primitiveTopology: mapPrimitiveMode(primitive.mode) });

  for (const [semantic, attribute] of ORDERED_ATTRIBUTES) {
    const accessorIndex = primitive.attributes[semantic];
    if (accessorIndex === undefined) continue;
    const decoded = decodeAccessor(document, buffers, accessorIndex);
    let data: Float32Array | Uint16Array;
    if (semantic === 'JOINTS_0') {
      data = toUint16(decoded.array);
    } else if (semantic === 'COLOR_0' && decoded.componentCount === 3) {
      data = expandColorToVec4(toFloat32(decoded.array), decoded.count);
    } else {
      data = toFloat32(decoded.array);
    }
    mesh.insertAttribute(attribute, data);
  }

  if (primitive.indices !== undefined) {
    mesh.setIndices(toIndices(decodeAccessor(document, buffers, primitive.indices).array));
  }

  const targets = primitive.targets;
  if (targets !== undefined && targets.length > 0) {
    const vertexCount = mesh.vertexCount;
    const zero = () => new Float32Array(vertexCount * 3);
    const morphTargets: MorphTarget[] = targets.map((target, i) => {
      const posIndex = target.POSITION;
      const nrmIndex = target.NORMAL;
      return {
        name: morph?.targetNames?.[i] ?? `Morph${i}`,
        positionDeltas:
          posIndex !== undefined ? toFloat32(decodeAccessor(document, buffers, posIndex).array) : zero(),
        normalDeltas:
          nrmIndex !== undefined ? toFloat32(decodeAccessor(document, buffers, nrmIndex).array) : zero(),
      };
    });
    mesh.morphTargets = new MorphTargets(morphTargets, vertexCount, morph?.defaultWeights);
  }

  return mesh;
};
