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
 * Append a glTF / GLB document's triangle geometry to `out` as a world-space,
 * non-indexed position soup (every 9 floats is one triangle) — the form
 * {@link renderMeshThumbnail} consumes. Each primitive's positions are baked
 * through its node's world matrix, optionally pre-multiplied by `base` (the
 * placing entity's world transform, when this document is one piece of a larger
 * prefab). Returns the number of mesh primitives the document carried (0 = a
 * mesh-less document such as an animation clip).
 */
export const collectGltfPositions = async (
  location: string,
  bytes: Uint8Array,
  read: (location: string) => Promise<Uint8Array>,
  out: number[],
  base?: Mat4,
  skipNodes?: ReadonlySet<number>,
): Promise<number> => {
  const { document, bin } = parseGltf(bytes);
  const buffers = await resolveBuffers(document, bin, makeSiblingReader(location, read));

  const nodes = document.nodes ?? [];
  const meshes = document.meshes ?? [];
  const identity = mat4.identity();

  // Resolve each mesh's world matrix from the scene graph (for correct placement
  // of multi-node models). A mesh not reached by the walk renders at identity, so
  // geometry still previews when the document's scene/node wiring is unusual. When
  // `skipNodes` is given (a prefab's hidden gltf nodes), those nodes and their
  // subtrees are pruned, and only reached meshes are collected.
  const meshWorld = new Map<number, Mat4>();
  const visited = new Set<number>();
  const walk = (nodeIndex: number, parent: Mat4): void => {
    const node = nodes[nodeIndex];
    if (node === undefined || visited.has(nodeIndex)) return;
    visited.add(nodeIndex);
    if (skipNodes?.has(nodeIndex) === true) return;
    const world = mat4.multiply(parent, nodeMatrix(node), mat4.create());
    if (node.mesh !== undefined && !meshWorld.has(node.mesh)) meshWorld.set(node.mesh, world);
    for (const child of node.children ?? []) walk(child, world);
  };
  const roots = document.scenes?.[document.scene ?? 0]?.nodes ?? nodes.map((_, i) => i);
  for (const root of roots) walk(root, identity);

  const reachedOnly = skipNodes !== undefined;
  let primitiveCount = 0;
  for (let mi = 0; mi < meshes.length; mi += 1) {
    if (reachedOnly && !meshWorld.has(mi)) continue;
    const local = meshWorld.get(mi) ?? identity;
    const world = base !== undefined ? mat4.multiply(base, local, mat4.create()) : local;
    for (const primitive of meshes[mi]?.primitives ?? []) {
      primitiveCount += 1;
      // A primitive whose mode/attributes the importer can't map (points, lines,
      // …) is skipped rather than failing the whole preview.
      let mesh: Mesh;
      try {
        mesh = mapPrimitiveToMesh(document, buffers, primitive);
      } catch {
        continue;
      }
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
          out.push(
            world[0]! * x + world[4]! * y + world[8]! * z + world[12]!,
            world[1]! * x + world[5]! * y + world[9]! * z + world[13]!,
            world[2]! * x + world[6]! * y + world[10]! * z + world[14]!,
          );
        }
      }
    }
  }
  return primitiveCount;
};

/**
 * Render a glTF / GLB document to a flat-shaded `size`×`size` RGBA8 preview. The
 * document's scene graph is walked, every mesh primitive's positions are baked
 * into world space (so multi-node models read correctly), and the merged geometry
 * is drawn through the shared {@link renderMeshThumbnail} CPU rasteriser. Materials
 * and textures are ignored — this is a shape preview, matching the `.rmesh` path.
 *
 * Returns `null` when the document carries no mesh primitives at all — a valid,
 * common case (an animation-clip glTF is skeleton + animation with no geometry),
 * so there is simply nothing to preview. Throws only when primitives exist but
 * none yield decodable triangle geometry (a malformed/unsupported mesh).
 */
export const renderGltfThumbnail = async (
  location: string,
  bytes: Uint8Array,
  size: number,
  read: (location: string) => Promise<Uint8Array>,
): Promise<Uint8Array | null> => {
  const positions: number[] = [];
  const primitiveCount = await collectGltfPositions(location, bytes, read, positions);

  // No primitives anywhere → a mesh-less document (e.g. an animation clip). Not an
  // error: there is nothing to preview, the browser shows the model icon.
  if (primitiveCount === 0) return null;
  if (positions.length === 0) {
    throw new Error(`glTF primitives decoded no triangle geometry (primitives=${primitiveCount})`);
  }

  const merged = new Mesh();
  merged.insertAttribute(MeshAttribute.POSITION, new Float32Array(positions));
  return renderMeshThumbnail(merged, size);
};
