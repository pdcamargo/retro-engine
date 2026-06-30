import {
  composeTransformInto,
  createMeshImporter,
  createSceneImporter,
  Mesh,
  MeshAttribute,
} from '@retro-engine/engine';
import { type Mat4, mat4, quat, vec3 } from '@retro-engine/math';

import { collectGltfPositions } from './gltf-thumbnail';
import { renderMeshThumbnail } from './mesh-thumbnail';

interface Transformish {
  translation?: readonly number[];
  rotation?: readonly number[];
  scale?: readonly number[];
}

const localMatrix = (data: Transformish): Mat4 => {
  const t = data.translation ?? [0, 0, 0];
  const r = data.rotation ?? [0, 0, 0, 1];
  const s = data.scale ?? [1, 1, 1];
  return composeTransformInto(
    mat4.create(),
    vec3.create(t[0] ?? 0, t[1] ?? 0, t[2] ?? 0),
    quat.create(r[0] ?? 0, r[1] ?? 0, r[2] ?? 0, r[3] ?? 1),
    vec3.create(s[0] ?? 1, s[1] ?? 1, s[2] ?? 1),
  );
};

/**
 * Render a prefab (a Scene-format asset) to a flat-shaded `size`×`size` RGBA8
 * preview, the same shape-only CPU rasteriser models use. The prefab's serialized
 * entities are walked: each `Mesh3d`'s referenced mesh is resolved by GUID, its
 * positions baked into the entity's world transform (composed up the serialized
 * `Parent` edges), and the merged geometry drawn through {@link renderMeshThumbnail}.
 *
 * Returns `null` when no mesh geometry is reachable — a prefab whose meshes are
 * runtime-instantiated (e.g. a nested glTF) or whose mesh GUIDs don't resolve to a
 * loadable `.rmesh` has nothing to preview, so the browser shows the prefab icon.
 */
export const renderPrefabThumbnail = async (
  bytes: Uint8Array,
  size: number,
  read: (location: string) => Promise<Uint8Array>,
  resolveLocation: (guid: string) => string | undefined,
): Promise<Uint8Array | null> => {
  const entities = (await createSceneImporter()(bytes, undefined as never)).data.entities;

  const localOf = new Map<number, Mat4>();
  const parentOf = new Map<number, number>();
  const meshOf = new Map<number, string>();
  const gltfOf = new Map<number, string>();
  const hiddenNodesOf = new Map<number, Set<number>>();
  for (const entity of entities) {
    // A prefab made from a glTF instance records per-node edits (e.g. hiding all
    // but the chosen character) as `derived` overrides keyed by gltf node index.
    // Collect the hidden nodes so the preview shows only what's visible.
    const derived = (entity as { derived?: readonly unknown[] }).derived;
    if (Array.isArray(derived)) {
      const hidden = new Set<number>();
      for (const raw of derived) {
        const d = raw as {
          kind?: string;
          anchor?: { node?: number };
          set?: readonly { type?: string; data?: { mode?: string } }[];
        };
        if (d.kind !== 'gltf-node' || typeof d.anchor?.node !== 'number') continue;
        for (const s of d.set ?? []) {
          if (s.type === 'Visibility' && s.data?.mode === 'Hidden') hidden.add(d.anchor.node);
        }
      }
      if (hidden.size > 0) hiddenNodesOf.set(entity.id, hidden);
    }
    let local: Mat4 = mat4.identity();
    for (const component of entity.components) {
      const handle = (component.data as { handle?: unknown }).handle;
      const guid = typeof handle === 'string' && handle.length > 0 ? handle : undefined;
      if (component.type === 'Transform') {
        local = localMatrix(component.data as Transformish);
      } else if (component.type === 'Parent') {
        const parent = (component.data as { entity?: number }).entity;
        if (typeof parent === 'number') parentOf.set(entity.id, parent);
      } else if (component.type === 'Mesh3d' && guid !== undefined) {
        meshOf.set(entity.id, guid);
      } else if (component.type === 'GltfSceneRoot' && guid !== undefined) {
        gltfOf.set(entity.id, guid);
      }
    }
    localOf.set(entity.id, local);
  }

  const worldOf = new Map<number, Mat4>();
  const computeWorld = (id: number, visiting: Set<number>): Mat4 => {
    const cached = worldOf.get(id);
    if (cached !== undefined) return cached;
    const local: Mat4 = localOf.get(id) ?? mat4.identity();
    const parent = parentOf.get(id);
    let world: Mat4 = local;
    if (parent !== undefined && localOf.has(parent) && !visiting.has(id)) {
      visiting.add(id);
      const parentWorld = computeWorld(parent, visiting);
      visiting.delete(id);
      // Explicit destination so the result keeps the concrete Mat4 type.
      world = mat4.multiply(parentWorld, local, mat4.create());
    }
    worldOf.set(id, world);
    return world;
  };

  const importer = createMeshImporter();
  const positions: number[] = [];

  // Mesh3d entities: bake the referenced mesh's positions by the entity's world.
  for (const [id, guid] of meshOf) {
    const location = resolveLocation(guid);
    if (location === undefined) continue;
    let mesh: Mesh;
    try {
      mesh = await importer(await read(location), undefined as never);
    } catch {
      continue;
    }
    const pos = mesh.getAttribute(MeshAttribute.POSITION)?.data;
    if (!(pos instanceof Float32Array)) continue;
    const world = computeWorld(id, new Set());
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

  // GltfSceneRoot entities: reuse the model geometry extraction, baked by the
  // entity's world (a prefab made from a dropped model lands here).
  for (const [id, guid] of gltfOf) {
    const location = resolveLocation(guid);
    if (location === undefined) continue;
    try {
      await collectGltfPositions(
        location,
        await read(location),
        read,
        positions,
        computeWorld(id, new Set()),
        hiddenNodesOf.get(id),
      );
    } catch {
      // Unreadable / undecodable model — skip it; other geometry may still preview.
    }
  }

  if (positions.length === 0) return null;
  const merged = new Mesh();
  merged.insertAttribute(MeshAttribute.POSITION, new Float32Array(positions));
  return renderMeshThumbnail(merged, size);
};
