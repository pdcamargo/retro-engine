import { composeTransformInto, Mesh, MeshAttribute } from '@retro-engine/engine';
import { mapPrimitiveToMesh, parseGltf, resolveBuffers, type SiblingReader } from '@retro-engine/gltf';
import { type Mat4, mat4, quat, vec3 } from '@retro-engine/math';

import { renderMeshThumbnail } from './mesh-thumbnail';

/** Decode a `data:` URI's bytes, or read an external sibling through `read`. */
const makeSiblingReader = (
  location: string,
  read: (location: string) => Promise<Uint8Array>,
): SiblingReader => {
  const dir = location.slice(0, location.lastIndexOf('/') + 1);
  return async (rel: string): Promise<Uint8Array> => {
    if (rel.startsWith('data:')) {
      const comma = rel.indexOf(',');
      const meta = rel.slice(5, comma);
      const payload = rel.slice(comma + 1);
      if (meta.endsWith(';base64')) {
        const binary = atob(payload);
        const out = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
        return out;
      }
      return new TextEncoder().encode(decodeURIComponent(payload));
    }
    return read(dir + decodeURIComponent(rel));
  };
};

/** A node's local matrix: its explicit `matrix` if present, else its composed TRS. */
const nodeMatrix = (node: {
  matrix?: readonly number[];
  translation?: readonly number[];
  rotation?: readonly number[];
  scale?: readonly number[];
}): Mat4 => {
  if (node.matrix !== undefined) return new Float32Array(node.matrix) as Mat4;
  const t = node.translation ?? [0, 0, 0];
  const r = node.rotation ?? [0, 0, 0, 1];
  const s = node.scale ?? [1, 1, 1];
  return composeTransformInto(
    mat4.create(),
    vec3.create(t[0], t[1], t[2]),
    quat.create(r[0], r[1], r[2], r[3]),
    vec3.create(s[0], s[1], s[2]),
  );
};

/**
 * Render a glTF / GLB document to a flat-shaded `size`×`size` RGBA8 preview. The
 * document's scene graph is walked, every mesh primitive's positions are baked
 * into world space (so multi-node models read correctly), and the merged geometry
 * is drawn through the shared {@link renderMeshThumbnail} CPU rasteriser. Materials
 * and textures are ignored — this is a shape preview, matching the `.rmesh` path.
 */
export const renderGltfThumbnail = async (
  location: string,
  bytes: Uint8Array,
  size: number,
  read: (location: string) => Promise<Uint8Array>,
): Promise<Uint8Array> => {
  const { document, bin } = parseGltf(bytes);
  const buffers = await resolveBuffers(document, bin, makeSiblingReader(location, read));

  const nodes = document.nodes ?? [];
  const meshes = document.meshes ?? [];
  // World-space triangle soup (non-indexed): every 9 floats are one triangle, the
  // shape renderMeshThumbnail consumes when a mesh carries no index buffer.
  const positions: number[] = [];

  const visited = new Set<number>();
  const walk = (nodeIndex: number, parent: Mat4): void => {
    const node = nodes[nodeIndex];
    if (node === undefined || visited.has(nodeIndex)) return;
    visited.add(nodeIndex);
    const world = mat4.multiply(parent, nodeMatrix(node));

    if (node.mesh !== undefined) {
      for (const primitive of meshes[node.mesh]?.primitives ?? []) {
        const mesh = mapPrimitiveToMesh(document, buffers, primitive);
        const pos = mesh.getAttribute(MeshAttribute.POSITION)?.data;
        if (!(pos instanceof Float32Array)) continue;
        const index = mesh.indices?.data;
        const triCount = index !== undefined ? Math.floor(index.length / 3) : Math.floor(pos.length / 9);
        for (let t = 0; t < triCount; t += 1) {
          for (let k = 0; k < 3; k += 1) {
            const vi = index !== undefined ? index[t * 3 + k]! : t * 3 + k;
            const x = pos[vi * 3]!;
            const y = pos[vi * 3 + 1]!;
            const z = pos[vi * 3 + 2]!;
            positions.push(
              world[0]! * x + world[4]! * y + world[8]! * z + world[12]!,
              world[1]! * x + world[5]! * y + world[9]! * z + world[13]!,
              world[2]! * x + world[6]! * y + world[10]! * z + world[14]!,
            );
          }
        }
      }
    }
    for (const child of node.children ?? []) walk(child, world);
  };

  const roots = document.scenes?.[document.scene ?? 0]?.nodes ?? nodes.map((_, i) => i);
  const identity = mat4.identity();
  for (const root of roots) walk(root, identity);

  if (positions.length === 0) throw new Error('glTF has no triangle geometry to preview');

  const merged = new Mesh();
  merged.insertAttribute(MeshAttribute.POSITION, new Float32Array(positions));
  return renderMeshThumbnail(merged, size);
};
