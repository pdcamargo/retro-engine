import { Transform } from '@retro-engine/engine';
import { mat4, quat, vec3 } from '@retro-engine/math';
import type { Mat4 } from '@retro-engine/math';

import { decodeAccessor } from './accessor';
import type { MappedGltfAssets } from './asset-mapping';
import type { Gltf, GltfMesh, GltfNode, GltfScene, GltfSkin } from './gltf-root';
import type { GltfDocument, GltfNode as GltfNodeJson } from './schema';

/**
 * Build a name-keyed map from a parallel list, keeping the first occurrence of
 * each name in document order (glTF names are not unique) and skipping unnamed
 * entries.
 */
const byName = <T>(items: readonly T[], nameOf: (item: T) => string | undefined): Map<string, T> => {
  const map = new Map<string, T>();
  for (const item of items) {
    const name = nameOf(item);
    if (name !== undefined && !map.has(name)) map.set(name, item);
  }
  return map;
};

/** Local {@link Transform} for a node: the TRS triple, or the decomposed `matrix`. */
const nodeTransform = (node: GltfNodeJson): Transform => {
  if (node.matrix !== undefined) {
    const m = node.matrix;
    const translation = mat4.getTranslation(m, vec3.create());
    const scale = mat4.getScaling(m, vec3.create());
    // `quat.fromMat` expects a pure-rotation basis, so divide each basis column
    // by its scale before extracting the rotation.
    const sx = scale[0] || 1;
    const sy = scale[1] || 1;
    const sz = scale[2] || 1;
    const rotationOnly = [
      m[0]! / sx, m[1]! / sx, m[2]! / sx, m[3]!,
      m[4]! / sy, m[5]! / sy, m[6]! / sy, m[7]!,
      m[8]! / sz, m[9]! / sz, m[10]! / sz, m[11]!,
      m[12]!, m[13]!, m[14]!, m[15]!,
    ];
    return new Transform(translation, quat.fromMat(rotationOnly, quat.create()), scale);
  }
  const t = node.translation;
  const r = node.rotation;
  const s = node.scale;
  return new Transform(
    t !== undefined ? vec3.create(t[0], t[1], t[2]) : undefined,
    r !== undefined ? quat.create(r[0], r[1], r[2], r[3]) : undefined,
    s !== undefined ? vec3.create(s[0], s[1], s[2]) : undefined,
  );
};

/**
 * Decode a skin's inverse bind matrices into a list parallel to its joints.
 * When the source omits the accessor the spec defines every matrix as identity,
 * so the list is filled with fresh identity matrices to keep it joint-aligned.
 */
const skinInverseBinds = (
  document: GltfDocument,
  buffers: readonly Uint8Array[],
  jointCount: number,
  accessorIndex: number | undefined,
): Mat4[] => {
  if (accessorIndex === undefined) {
    return Array.from({ length: jointCount }, () => mat4.identity());
  }
  const decoded = decodeAccessor(document, buffers, accessorIndex);
  const flat = decoded.array instanceof Float32Array ? decoded.array : new Float32Array(decoded.array);
  return Array.from({ length: jointCount }, (_unused, i) => flat.slice(i * 16, i * 16 + 16) as Mat4);
};

/**
 * Assemble a {@link Gltf} root asset from a parsed document and the engine
 * assets its meshes/materials/images already mapped to (see `mapGltfAssets`).
 * Pure and synchronous: it copies the document's scene/node graph into the
 * engine-facing shape (TRS transforms, handle references, name maps, decoded
 * skins) without touching any store or instantiating anything. `buffers` are the
 * already-resolved binary buffers, needed to decode skin inverse bind matrices.
 */
export const buildGltfRoot = (
  document: GltfDocument,
  mapped: MappedGltfAssets,
  buffers: readonly Uint8Array[] = [],
): Gltf => {
  const docMeshes = document.meshes ?? [];
  const meshes: GltfMesh[] = mapped.meshes.map((m, i) => {
    const primitives = m.primitives.map((p) =>
      p.material !== undefined ? { mesh: p.mesh, material: p.material } : { mesh: p.mesh },
    );
    const name = docMeshes[i]?.name;
    return name !== undefined ? { primitives, name } : { primitives };
  });

  const docNodes = document.nodes ?? [];
  const nodes: GltfNode[] = docNodes.map((node) => {
    const base: GltfNode = { transform: nodeTransform(node), children: node.children ?? [] };
    const withMesh = node.mesh !== undefined ? { ...base, mesh: node.mesh } : base;
    const withSkin = node.skin !== undefined ? { ...withMesh, skin: node.skin } : withMesh;
    return node.name !== undefined ? { ...withSkin, name: node.name } : withSkin;
  });

  const skins: GltfSkin[] = (document.skins ?? []).map((skin) => {
    const joints = skin.joints ?? [];
    const inverseBindMatrices = skinInverseBinds(document, buffers, joints.length, skin.inverseBindMatrices);
    const base: GltfSkin = { joints, inverseBindMatrices };
    const withSkeleton = skin.skeleton !== undefined ? { ...base, skeleton: skin.skeleton } : base;
    return skin.name !== undefined ? { ...withSkeleton, name: skin.name } : withSkeleton;
  });

  const docScenes = document.scenes ?? [];
  const scenes: GltfScene[] = docScenes.map((scene) =>
    scene.name !== undefined
      ? { nodes: scene.nodes ?? [], name: scene.name }
      : { nodes: scene.nodes ?? [] },
  );
  const defaultScene = document.scene !== undefined ? scenes[document.scene] : undefined;

  const docMaterials = document.materials ?? [];
  const namedMaterials = new Map<string, (typeof mapped.materials)[number]>();
  mapped.materials.forEach((handle, i) => {
    const name = docMaterials[i]?.name;
    if (name !== undefined && !namedMaterials.has(name)) namedMaterials.set(name, handle);
  });

  return {
    scenes,
    namedScenes: byName(scenes, (s) => s.name),
    ...(defaultScene !== undefined ? { defaultScene } : {}),
    meshes,
    namedMeshes: byName(meshes, (m) => m.name),
    materials: mapped.materials,
    namedMaterials,
    images: mapped.images,
    nodes,
    namedNodes: byName(nodes, (n) => n.name),
    skins,
    animationClips: mapped.animationClips,
  };
};
