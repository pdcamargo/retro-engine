import type { ComponentType, Entity, World } from '@retro-engine/ecs';
import type { Mat4 } from '@retro-engine/math';
import type { Renderer } from '@retro-engine/renderer-core';

import { Camera } from '../camera/camera';
import type { SortedCameras } from '../camera/sorted-cameras';
import { SortedSlotIndex } from '../instance/retained-draw-order';
import { RetainedInstanceBuffer } from '../instance/retained-instance-buffer';
import type { Slot } from '../instance/retained-slot-map';
import type { MeshAllocator, MeshHandle, RenderMeshes } from '../mesh';
import { GlobalTransform } from '../transform';
import { ViewVisibility } from '../visibility/visibility';

import type { Material } from './material';
import type { AlphaBucket } from './instance-batching';
import { MESH_INSTANCE_BYTE_SIZE, packInstanceTransform } from './instance-layout';
import type { MaterialHandle } from './materials';
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
  readonly meshHandle: MeshHandle;
  readonly materialHandle: MaterialHandle<M>;
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

/** One drawable mesh captured during the structural walk; the per-camera key is derived from it. */
interface ActiveMesh<M extends Material> {
  entity: Entity;
  slot: Slot;
  bucket: AlphaBucket;
  bucketRank: number;
  worldX: number;
  worldY: number;
  worldZ: number;
  groupKey: string;
  meshHandle: MeshHandle;
  materialHandle: MaterialHandle<M>;
  changed: boolean;
}

/**
 * Render-world resource backing the retained mesh prepare path for one material
 * plugin. The slot buffer holds each entity's camera-independent model +
 * inverse-transpose once; a {@link SortedSlotIndex} per active camera owns that
 * camera's ordered GPU buffer (depth-sorted where the bucket requires it).
 *
 * @internal
 */
export class RetainedMeshBuffer<M extends Material> {
  /** Slot buffer: CPU scratch only (`gpu: false`); each camera's ordered index owns a drawn buffer. */
  readonly slotBuf = new RetainedInstanceBuffer(MESH_INSTANCE_BYTE_SIZE, 'mesh-slot', false);
  /** One ordered index (and GPU buffer) per active camera, keyed by camera entity. */
  readonly indexByCamera = new Map<Entity, SortedSlotIndex<MeshKey<M>>>();
  lastPrepareTick = 0;

  readonly seen = new Set<Entity>();
  readonly active: ActiveMesh<M>[] = [];
  readonly freeList: Entity[] = [];
  /** Transforms queued for packing after the slot scratch is grown (reused each frame). */
  readonly packEntities: Entity[] = [];
  readonly packMatrices: Mat4[] = [];
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

  /** Drop ordered indexes for cameras absent from `present` this frame. */
  reapCameras(present: Set<Entity>): void {
    for (const [camera, index] of this.indexByCamera) {
      if (!present.has(camera)) {
        index.dispose();
        this.indexByCamera.delete(camera);
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

/** Read-only resources the structural walk needs to decide drawability + bucket. */
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
 * Change-gated retained mesh prepare, shared by the 3D and 2D material plugins.
 *
 * Repacks an entity's model + inverse-transpose only on `Changed<GlobalTransform>`
 * (the expensive `mat4.invert`), and re-batches a camera's ordered buffer only
 * when its membership, a member's `(mesh, material)` pair, or — for depth-ordered
 * buckets — the camera or a member's world position changed. A static scene does
 * O(0) packing and re-sorting; a moving camera reorders the transparent bucket by
 * memcpy, never re-packing.
 *
 * Queries the main `world` with a self-managed since-tick (render-stage params
 * carry the render world's tick), mirroring {@link prepareSpritesRetained}.
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
  const { slotBuf } = retained;
  const slots = slotBuf.slots;
  const packEntities = retained.packEntities;
  const packMatrices = retained.packMatrices;
  packEntities.length = 0;
  packMatrices.length = 0;

  // 1. Changed sets, each scoped to the rows it must touch — NOT a full-world
  //    `Changed<GlobalTransform>` scan. Renderable transforms (byte repack +
  //    depth) and (mesh, material) handle changes (re-grouping) scope to this
  //    path's archetype; camera moves (depth recompute) scope to camera
  //    entities. This keeps each scan O(this path's entities), so the 3D and 2D
  //    prepares no longer each walk every transform in the scene.
  const changedTransforms = new Set<Entity>();
  for (const row of world
    .query([meshType, materialType, GlobalTransform, ViewVisibility], { changed: [GlobalTransform] }, since)
    .entries()) {
    changedTransforms.add(row[0] as Entity);
  }
  const changedGroup = new Set<Entity>();
  for (const row of world
    .query([meshType, materialType, GlobalTransform, ViewVisibility], { changed: [meshType] }, since)
    .entries()) {
    changedGroup.add(row[0] as Entity);
  }
  for (const row of world
    .query([meshType, materialType, GlobalTransform, ViewVisibility], { changed: [materialType] }, since)
    .entries()) {
    changedGroup.add(row[0] as Entity);
  }
  const movedCameras = new Set<Entity>();
  for (const row of world.query([Camera, GlobalTransform], { changed: [GlobalTransform] }, since).entries()) {
    movedCameras.add(row[0] as Entity);
  }

  // 2. Structural walk (once, camera-independent): allocate slots, capture the
  //    drawable set, and queue Changed<GlobalTransform> / new entities for packing.
  const seen = retained.seen;
  const active = retained.active;
  seen.clear();
  active.length = 0;

  world.query([meshType, materialType, GlobalTransform, ViewVisibility]).forEach((row) => {
    const entity = row[0] as Entity;
    const mesh = row[1] as { handle: MeshHandle };
    const material = row[2] as { handle: MaterialHandle<M> };
    const gt = row[3] as GlobalTransform;
    const vis = row[4] as ViewVisibility;
    if (!vis.visible) return;

    const renderMesh = renderMeshes.get(mesh.handle);
    if (renderMesh === undefined) return;
    if (allocator.vertexSlice(mesh.handle) === undefined) return;
    if (renderMesh.bufferInfo.kind === 'indexed' && allocator.indexSlice(mesh.handle) === undefined) {
      return;
    }
    if (renderMaterials.get(material.handle) === undefined) return;
    seen.add(entity);

    const instance = mainWorldMaterials?.get(material.handle);
    const alphaMode = instance?.alphaMode?.() ?? 'opaque';
    const bucket: AlphaBucket = alphaMode === 'opaque' ? 'opaque' : alphaMode === 'blend' ? 'blend' : 'mask';

    let slot = slots.get(entity);
    const isNew = slot === undefined;
    if (slot === undefined) slot = slots.alloc(entity, 1);
    active.push({
      entity,
      slot,
      bucket,
      bucketRank: BUCKET_RANK[bucket],
      worldX: gt.matrix[12] as number,
      worldY: gt.matrix[13] as number,
      worldZ: gt.matrix[14] as number,
      groupKey: `${mesh.handle}/${material.handle}`,
      meshHandle: mesh.handle,
      materialHandle: material.handle,
      changed: isNew || changedTransforms.has(entity) || changedGroup.has(entity),
    });
    // Capture the matrix for packing after ensureCapacity grows the scratch.
    if (isNew || changedTransforms.has(entity)) {
      packEntities.push(entity);
      packMatrices.push(gt.matrix as Mat4);
    }
  });

  // 3. Grow slot scratch, then pack the queued transforms into their slots.
  slotBuf.ensureCapacity(renderer);
  for (let i = 0; i < packEntities.length; i++) {
    const slot = slots.get(packEntities[i]!)!;
    packInstanceTransform(slotBuf.scratchF32, slotBuf.floatOffsetOf(slot.first), packMatrices[i]!);
  }

  // 4. Per active camera: recompute depths on a camera move, then sync members.
  const present = retained.cameraScratch;
  present.clear();
  for (const view of cameras.views) {
    if (view.subGraph !== subGraphLabel) continue;
    const camera = view.sourceEntity as Entity;
    present.add(camera);
    const v = view.viewMatrix as Float32Array;
    const index = retained.indexFor(camera);

    if (movedCameras.has(camera)) {
      index.recomputeKeys((k) => ({ ...k, depth: viewDepth(v, k.worldX, k.worldY, k.worldZ) }));
    }

    for (const a of active) {
      const known = index.has(a.entity);
      if (known && !a.changed) continue; // unchanged member, no work
      const key: MeshKey<M> = {
        bucket: a.bucket,
        bucketRank: a.bucketRank,
        depth: viewDepth(v, a.worldX, a.worldY, a.worldZ),
        worldX: a.worldX,
        worldY: a.worldY,
        worldZ: a.worldZ,
        groupKey: a.groupKey,
        meshHandle: a.meshHandle,
        materialHandle: a.materialHandle,
      };
      if (known) index.updateMember(a.entity, key, slotBuf.store);
      else index.addMember(a.entity, a.slot, key);
    }
  }

  // 5. Sweep despawned / now-invisible entities from every camera + the slots.
  if (seen.size !== slots.size) {
    const freeList = retained.freeList;
    freeList.length = 0;
    for (const [entity] of slots.entries()) {
      if (!seen.has(entity)) freeList.push(entity);
    }
    for (const entity of freeList) {
      slots.free(entity);
      for (const index of retained.indexByCamera.values()) index.removeMember(entity);
    }
  }

  // 6. Drop indexes for cameras that vanished; rebuild/flush the survivors.
  retained.reapCameras(present);
  for (const index of retained.indexByCamera.values()) index.prepare(slotBuf.store, renderer);

  retained.lastPrepareTick = tickNow;
};
