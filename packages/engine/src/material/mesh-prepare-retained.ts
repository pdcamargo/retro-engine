import type { Handle } from '@retro-engine/assets';
import type { ComponentType, Entity, World } from '@retro-engine/ecs';
import type { Mat4 } from '@retro-engine/math';
import type { Renderer } from '@retro-engine/renderer-core';

import type { SortedCameras } from '../camera/sorted-cameras';
import { SortedSlotIndex } from '../instance/retained-draw-order';
import { RetainedInstanceBuffer } from '../instance/retained-instance-buffer';
import type { Slot } from '../instance/retained-slot-map';
import type { Mesh, MeshAllocator, RenderMeshes } from '../mesh';
import { GlobalTransform } from '../transform';
import { ViewVisibility } from '../visibility/visibility';

import type { Material } from './material';
import type { AlphaBucket } from './instance-batching';
import { MESH_INSTANCE_BYTE_SIZE, packInstanceTransform } from './instance-layout';
import type { Materials } from './materials';
import type { RenderMaterials } from './render-materials';

const BUCKET_RANK: Readonly<Record<AlphaBucket, number>> = { opaque: 0, mask: 1, blend: 2 };

/**
 * Per-camera sort + batch key for a retained mesh instance. The instance bytes
 * (model + inverse-transpose) are camera-independent and live once per entity in
 * the slot buffer; this key carries the camera-space `depth` (for blend sort and
 * the phase item's `sortDepth`) plus the world position needed to recompute that
 * depth when the camera moves. `groupKey` (the `(mesh, material)` pair) drives
 * batch grouping exactly as the legacy `packInstancedBatches` does.
 */
export interface MeshKey<M extends Material> {
  readonly bucket: AlphaBucket;
  readonly bucketRank: number;
  readonly depth: number;
  readonly worldX: number;
  readonly worldY: number;
  readonly worldZ: number;
  readonly groupKey: string;
  readonly meshHandle: Handle<Mesh>;
  readonly materialHandle: Handle<M>;
}

/** Mirrors the legacy `packInstancedBatches` comparator (sans camera — the index is per-camera). */
const makeMeshCompare =
  <M extends Material>(depthOrdered: ReadonlySet<AlphaBucket>) =>
  (a: MeshKey<M>, b: MeshKey<M>): number => {
    if (a.bucketRank !== b.bucketRank) return a.bucketRank - b.bucketRank;
    if (depthOrdered.has(a.bucket) && a.depth !== b.depth) return b.depth - a.depth;
    return a.groupKey < b.groupKey ? -1 : a.groupKey > b.groupKey ? 1 : 0;
  };

const sameMeshBatch = <M extends Material>(a: MeshKey<M>, b: MeshKey<M>): boolean =>
  a.bucket === b.bucket && a.groupKey === b.groupKey;

const viewDepth = (v: Float32Array, x: number, y: number, z: number): number =>
  (v[2] as number) * x + (v[6] as number) * y + (v[10] as number) * z + (v[14] as number);

/** Camera-independent retained member data for one drawable mesh; the per-camera key derives from it. */
interface MeshMember<M extends Material> {
  slot: Slot;
  bucket: AlphaBucket;
  bucketRank: number;
  worldX: number;
  worldY: number;
  worldZ: number;
  groupKey: string;
  meshHandle: Handle<Mesh>;
  materialHandle: Handle<M>;
}

const VIEW_MATRIX_LEN = 16;

/** True iff the 16 view-matrix floats differ from the cached copy; updates the cache in place. */
const viewMatrixChanged = (cached: Float32Array, current: Float32Array): boolean => {
  let changed = false;
  for (let i = 0; i < VIEW_MATRIX_LEN; i++) {
    if (cached[i] !== current[i]) {
      changed = true;
      cached[i] = current[i] as number;
    }
  }
  return changed;
};

/**
 * Render-world resource backing the retained mesh prepare path for one material
 * plugin. The slot buffer holds each entity's camera-independent model +
 * inverse-transpose once; a {@link SortedSlotIndex} per active camera owns that
 * camera's ordered GPU buffer (depth-sorted where the bucket requires it). The
 * drawable set ({@link MeshMember} per entity) and per-camera depth are kept
 * across frames and mutated only by change events.
 *
 * @internal
 */
export class RetainedMeshBuffer<M extends Material> {
  /** Slot buffer: CPU scratch only (`gpu: false`); each camera's ordered index owns a drawn buffer. */
  readonly slotBuf = new RetainedInstanceBuffer(MESH_INSTANCE_BYTE_SIZE, 'mesh-slot', false);
  /** One ordered index (and GPU buffer) per active camera, keyed by camera entity. */
  readonly indexByCamera = new Map<Entity, SortedSlotIndex<MeshKey<M>>>();
  lastPrepareTick = 0;

  /** The retained drawable set: entity → camera-independent member data. */
  readonly members = new Map<Entity, MeshMember<M>>();
  /** Visible meshes whose mesh/material asset isn't ready yet; re-checked each frame. */
  readonly pending = new Set<Entity>();
  /** Per-frame deltas applied to every camera's ordered index. */
  readonly newlyActive = new Set<Entity>();
  readonly changedActive = new Set<Entity>();
  readonly freed = new Set<Entity>();
  /** Transforms queued for packing after the slot scratch is grown (reused each frame). */
  readonly packEntities: Entity[] = [];
  readonly packMatrices: Mat4[] = [];
  /** Last frame's view matrix per camera — the depth-recompute trigger. */
  private readonly lastViewByCamera = new Map<Entity, Float32Array>();
  private readonly camerasSeen = new Set<Entity>();

  constructor(private readonly depthOrdered: ReadonlySet<AlphaBucket>) {}

  /** Ordered index for `camera`, created (with the plugin's depth-ordering policy) on first use. */
  indexFor(camera: Entity): SortedSlotIndex<MeshKey<M>> {
    let index = this.indexByCamera.get(camera);
    if (index === undefined) {
      index = new SortedSlotIndex<MeshKey<M>>(
        MESH_INSTANCE_BYTE_SIZE,
        'mesh-instance',
        makeMeshCompare<M>(this.depthOrdered),
        sameMeshBatch,
      );
      this.indexByCamera.set(camera, index);
    }
    return index;
  }

  /** Cached view matrix for `camera`, allocated on first use. */
  lastViewFor(camera: Entity): Float32Array {
    let v = this.lastViewByCamera.get(camera);
    if (v === undefined) {
      v = new Float32Array(VIEW_MATRIX_LEN);
      this.lastViewByCamera.set(camera, v);
    }
    return v;
  }

  /** Drop ordered indexes + cached view matrices for cameras absent from `present` this frame. */
  reapCameras(present: Set<Entity>): void {
    for (const [camera, index] of this.indexByCamera) {
      if (!present.has(camera)) {
        index.dispose();
        this.indexByCamera.delete(camera);
        this.lastViewByCamera.delete(camera);
      }
    }
  }

  get cameraScratch(): Set<Entity> {
    return this.camerasSeen;
  }

  dispose(): void {
    this.slotBuf.dispose();
    for (const index of this.indexByCamera.values()) index.dispose();
    this.indexByCamera.clear();
  }
}

/** Read-only resources the membership step needs to decide drawability + bucket. */
export interface MeshPrepareDeps<M extends Material> {
  readonly renderMeshes: RenderMeshes;
  readonly allocator: MeshAllocator;
  readonly renderMaterials: RenderMaterials<M>;
  readonly mainWorldMaterials: Materials<M> | undefined;
}

export interface MeshPrepareOptions<M extends Material> {
  readonly meshType: ComponentType;
  readonly materialType: ComponentType;
  readonly cameras: SortedCameras;
  /** Only cameras driving this sub-graph (Core3d / Core2d) get an ordered buffer. */
  readonly subGraphLabel: string;
  readonly deps: MeshPrepareDeps<M>;
}

/**
 * Event-driven retained mesh prepare, shared by the 3D and 2D material plugins.
 *
 * Maintains the drawable set from change events alone — no per-frame walk of the
 * visible meshes. An entity is a member iff it is alive, carries
 * `mesh + material + GlobalTransform + ViewVisibility`, is visible, and its mesh
 * and material assets are uploaded. Membership flips on `Changed<ViewVisibility>`
 * (covers spawn-into-visible, since the cull flips a fresh entity false→true the
 * same frame) and the removed buffer (despawn / component removal); model +
 * inverse-transpose are repacked on `Changed<GlobalTransform>`, and a member's
 * `(mesh, material)` grouping on `Changed<mesh>` / `Changed<material>`. Each
 * camera's ordered buffer is re-sorted only when its membership, a member's
 * sort key, or — for depth-ordered buckets — the camera's view matrix changed.
 * A static scene with a static camera does O(0) work.
 *
 * Queries the main `world` with a self-managed since-tick (render-stage params
 * carry the render world's tick), mirroring `prepareSpritesRetained`.
 */
export const prepareMeshRetained = <M extends Material>(
  world: World,
  renderer: Renderer,
  retained: RetainedMeshBuffer<M>,
  options: MeshPrepareOptions<M>,
): void => {
  const tickNow = world.changeTick;
  const since = retained.lastPrepareTick;
  const { meshType, materialType, cameras, subGraphLabel, deps } = options;
  const { renderMeshes, allocator, renderMaterials, mainWorldMaterials } = deps;
  const { slotBuf, members, pending, newlyActive, changedActive, freed } = retained;
  const slots = slotBuf.slots;
  const packEntities = retained.packEntities;
  const packMatrices = retained.packMatrices;
  packEntities.length = 0;
  packMatrices.length = 0;
  newlyActive.clear();
  changedActive.clear();
  freed.clear();

  const isRenderable = (meshHandle: Handle<Mesh>, materialHandle: Handle<M>): boolean => {
    const renderMesh = renderMeshes.get(meshHandle);
    if (renderMesh === undefined) return false;
    if (allocator.vertexSlice(meshHandle.index) === undefined) return false;
    if (renderMesh.bufferInfo.kind === 'indexed' && allocator.indexSlice(meshHandle.index) === undefined) {
      return false;
    }
    return renderMaterials.get(materialHandle) !== undefined;
  };

  const bucketOf = (materialHandle: Handle<M>): AlphaBucket => {
    const alphaMode = mainWorldMaterials?.get(materialHandle)?.alphaMode?.() ?? 'opaque';
    return alphaMode === 'opaque' ? 'opaque' : alphaMode === 'blend' ? 'blend' : 'mask';
  };

  const drop = (entity: Entity): void => {
    if (members.has(entity)) {
      slots.free(entity);
      members.delete(entity);
      freed.add(entity);
    }
    pending.delete(entity);
  };

  // Admit a now-eligible, renderable mesh: allocate a slot (if new), record the
  // member, and queue its transform for packing. A fresh slot goes to
  // `newlyActive` (addMember on every camera); an existing one to `changedActive`.
  const admit = (
    entity: Entity,
    meshHandle: Handle<Mesh>,
    materialHandle: Handle<M>,
    gt: GlobalTransform,
  ): void => {
    let slot = slots.get(entity);
    const isNew = slot === undefined;
    if (slot === undefined) slot = slots.alloc(entity, 1);
    const bucket = bucketOf(materialHandle);
    members.set(entity, {
      slot,
      bucket,
      bucketRank: BUCKET_RANK[bucket],
      worldX: gt.matrix[12] as number,
      worldY: gt.matrix[13] as number,
      worldZ: gt.matrix[14] as number,
      groupKey: `${meshHandle.index}/${materialHandle.index}`,
      meshHandle,
      materialHandle,
    });
    packEntities.push(entity);
    packMatrices.push(gt.matrix as Mat4);
    if (isNew) newlyActive.add(entity);
    else changedActive.add(entity);
  };

  // 1. Visibility transitions (and spawn-into-visible).
  for (const row of world
    .query([meshType, materialType, GlobalTransform, ViewVisibility], { changed: [ViewVisibility] }, since)
    .entries()) {
    const entity = row[0] as Entity;
    const mesh = row[1] as { handle: Handle<Mesh> };
    const material = row[2] as { handle: Handle<M> };
    const gt = row[3] as GlobalTransform;
    const vis = row[4] as ViewVisibility;
    if (!vis.visible) {
      drop(entity);
    } else if (isRenderable(mesh.handle, material.handle)) {
      pending.delete(entity);
      admit(entity, mesh.handle, material.handle, gt);
    } else {
      drop(entity); // free any stale slot
      pending.add(entity);
    }
  }

  // 2. Despawns / mesh|material removals: free the slot.
  for (const { entity, tick } of world.getRemovedComponents(meshType)) {
    if (tick > since) drop(entity);
  }
  for (const { entity, tick } of world.getRemovedComponents(materialType)) {
    if (tick > since) drop(entity);
  }

  // 3. Pending drain (residual O(k); k → 0 once a static scene's assets upload).
  for (const entity of pending) {
    const vis = world.getComponent(entity, ViewVisibility);
    if (vis === undefined || !vis.visible) {
      pending.delete(entity);
      continue;
    }
    const mesh = world.getComponent(entity, meshType) as { handle: Handle<Mesh> } | undefined;
    const material = world.getComponent(entity, materialType) as { handle: Handle<M> } | undefined;
    const gt = world.getComponent(entity, GlobalTransform);
    if (mesh === undefined || material === undefined || gt === undefined) {
      pending.delete(entity);
      continue;
    }
    if (isRenderable(mesh.handle, material.handle)) {
      pending.delete(entity);
      admit(entity, mesh.handle, material.handle, gt);
    }
  }

  // 4. Transform repacks: reposition members whose GlobalTransform changed.
  for (const row of world
    .query([meshType, materialType, GlobalTransform, ViewVisibility], { changed: [GlobalTransform] }, since)
    .entries()) {
    const entity = row[0] as Entity;
    if (newlyActive.has(entity)) continue; // already packed fresh this frame
    const member = members.get(entity);
    if (member === undefined) continue; // invisible / pending — no slot to repack
    const gt = row[3] as GlobalTransform;
    member.worldX = gt.matrix[12] as number;
    member.worldY = gt.matrix[13] as number;
    member.worldZ = gt.matrix[14] as number;
    packEntities.push(entity);
    packMatrices.push(gt.matrix as Mat4);
    changedActive.add(entity);
  }

  // 5. Regrouping: a member's (mesh, material) pair changed → new groupKey/bucket
  //    (no transform repack; only the sort key moves).
  const regroup = (entity: Entity, meshHandle: Handle<Mesh>, materialHandle: Handle<M>): void => {
    if (newlyActive.has(entity)) return;
    const member = members.get(entity);
    if (member === undefined) return;
    member.bucket = bucketOf(materialHandle);
    member.bucketRank = BUCKET_RANK[member.bucket];
    member.groupKey = `${meshHandle.index}/${materialHandle.index}`;
    member.meshHandle = meshHandle;
    member.materialHandle = materialHandle;
    changedActive.add(entity);
  };
  for (const row of world
    .query([meshType, materialType, GlobalTransform, ViewVisibility], { changed: [meshType] }, since)
    .entries()) {
    regroup(row[0] as Entity, (row[1] as { handle: Handle<Mesh> }).handle, (row[2] as { handle: Handle<M> }).handle);
  }
  for (const row of world
    .query([meshType, materialType, GlobalTransform, ViewVisibility], { changed: [materialType] }, since)
    .entries()) {
    regroup(row[0] as Entity, (row[1] as { handle: Handle<Mesh> }).handle, (row[2] as { handle: Handle<M> }).handle);
  }

  // 6. Grow slot scratch, then pack the queued transforms into their slots.
  slotBuf.ensureCapacity(renderer);
  for (let i = 0; i < packEntities.length; i++) {
    const slot = slots.get(packEntities[i]!)!;
    packInstanceTransform(slotBuf.scratchF32, slotBuf.floatOffsetOf(slot.first), packMatrices[i]!);
  }

  // 7. Per active camera: seed a brand-new camera from the whole member set;
  //    otherwise recompute depths on a view-matrix change, then apply the deltas.
  const present = retained.cameraScratch;
  present.clear();
  const buildKey = (m: MeshMember<M>, v: Float32Array): MeshKey<M> => ({
    bucket: m.bucket,
    bucketRank: m.bucketRank,
    depth: viewDepth(v, m.worldX, m.worldY, m.worldZ),
    worldX: m.worldX,
    worldY: m.worldY,
    worldZ: m.worldZ,
    groupKey: m.groupKey,
    meshHandle: m.meshHandle,
    materialHandle: m.materialHandle,
  });

  for (const view of cameras.views) {
    if (view.subGraph !== subGraphLabel) continue;
    const camera = view.sourceEntity as Entity;
    present.add(camera);
    const v = view.viewMatrix as Float32Array;
    const existed = retained.indexByCamera.has(camera);
    const index = retained.indexFor(camera);
    const cachedView = retained.lastViewFor(camera);

    if (!existed) {
      // Seed from the full member set (O(members), only on the frame a camera appears).
      for (const [entity, m] of members) index.addMember(entity, m.slot, buildKey(m, v));
      cachedView.set(v.subarray(0, VIEW_MATRIX_LEN));
      continue;
    }

    if (viewMatrixChanged(cachedView, v)) {
      index.recomputeKeys((k) => ({ ...k, depth: viewDepth(v, k.worldX, k.worldY, k.worldZ) }));
    }
    for (const entity of freed) index.removeMember(entity);
    for (const entity of newlyActive) {
      const m = members.get(entity);
      if (m !== undefined) index.addMember(entity, m.slot, buildKey(m, v));
    }
    for (const entity of changedActive) {
      if (!index.has(entity)) continue;
      const m = members.get(entity);
      if (m !== undefined) index.updateMember(entity, buildKey(m, v), slotBuf.store);
    }
  }

  // 8. Drop indexes for cameras that vanished; rebuild/flush the survivors.
  retained.reapCameras(present);
  for (const index of retained.indexByCamera.values()) index.prepare(slotBuf.store, renderer);

  retained.lastPrepareTick = tickNow;
};
