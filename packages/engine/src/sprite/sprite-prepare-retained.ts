import type { Entity, World } from '@retro-engine/ecs';
import type { Mat4 } from '@retro-engine/math';
import type { Renderer, RenderPassEncoder } from '@retro-engine/renderer-core';

import type { SortedCameras } from '../camera/sorted-cameras';
import type { ImageHandle, Images } from '../image/images';
import type { RenderImages } from '../image/image-plugin';
import type { App, RenderContext } from '../index';
import { SortedSlotIndex } from '../instance/retained-draw-order';
import { RetainedInstanceBuffer } from '../instance/retained-instance-buffer';
import { Core2dLabel } from '../render-graph/core-2d';
import type { PhaseItem2d, ViewPhases2d } from '../render-graph/phase-2d';
import { GlobalTransform } from '../transform';
import { ViewVisibility } from '../visibility/visibility';

import { Sprite } from './sprite';
import { packSpriteInstance, SPRITE_INSTANCE_BYTE_SIZE, type SpriteAlphaBucket } from './sprite-batch';
import { instanceCountForSprite } from './sprite-batch-prepare';
import type { SpritePipeline } from './sprite-pipeline';

/**
 * Per-sprite sort + batch key. Mirrors the legacy `sortAndEmitSpriteBatches`
 * ordering exactly: opaque bucket first, then back-to-front by world Z, ties
 * broken by image so same-image runs stay contiguous. `bucket` rides along for
 * the queue's phase routing; `worldZ` is camera-independent, so the ordered
 * buffer is shared across all 2D cameras (a camera move never re-sorts it).
 */
interface SpriteSortKey {
  readonly bucketKey: 0 | 1;
  readonly bucket: SpriteAlphaBucket;
  readonly worldZ: number;
  readonly imageHandle: ImageHandle;
}

const compareSpriteSortKey = (a: SpriteSortKey, b: SpriteSortKey): number => {
  if (a.bucketKey !== b.bucketKey) return a.bucketKey - b.bucketKey;
  if (a.worldZ !== b.worldZ) return b.worldZ - a.worldZ;
  return a.imageHandle < b.imageHandle ? -1 : a.imageHandle > b.imageHandle ? 1 : 0;
};

const sameSpriteBatch = (a: SpriteSortKey, b: SpriteSortKey): boolean =>
  a.imageHandle === b.imageHandle && a.bucketKey === b.bucketKey;

/** Compaction policy: only worth a full re-upload once holes dominate and are large. */
const COMPACT_FRAGMENTATION = 0.5 as const;
const COMPACT_MIN_FREE = 1024 as const;

/**
 * Render-world resource backing the retained sprite prepare path.
 *
 * Holds the slot buffer (CPU-only staging — sprite bytes packed at stable
 * per-entity slots), the {@link SortedSlotIndex} owning the ordered GPU buffer
 * the draws read, the main-world change-tick watermark, and reused scratch
 * collections so a steady-state frame allocates almost nothing.
 *
 * @internal
 */
export class RetainedSpriteBuffer {
  /** Slot buffer: CPU scratch only (`gpu: false`); the ordered index owns the drawn buffer. */
  readonly slotBuf = new RetainedInstanceBuffer(SPRITE_INSTANCE_BYTE_SIZE, 'sprite-slot', false);
  readonly index = new SortedSlotIndex<SpriteSortKey>(
    SPRITE_INSTANCE_BYTE_SIZE,
    'sprite-instance',
    compareSpriteSortKey,
    sameSpriteBatch,
  );
  /** Main-world `changeTick` observed at the last prepare — the changed-query threshold. */
  lastPrepareTick = 0;

  /** Visible sprites whose image hasn't uploaded yet; re-checked each frame until ready. */
  readonly pending = new Set<Entity>();
  readonly newThisFrame = new Set<Entity>();
  readonly changed = new Set<Entity>();
  readonly packEntities: Entity[] = [];
  readonly packSprites: Sprite[] = [];
  readonly packGts: GlobalTransform[] = [];

  dispose(): void {
    this.slotBuf.dispose();
    this.index.dispose();
  }
}

/**
 * Event-driven retained sprite prepare.
 *
 * Maintains the per-entity slot set from change events alone — no per-frame walk
 * of the visible set. An entity holds a slot iff it is alive, carries
 * `Sprite + GlobalTransform + ViewVisibility`, is `ViewVisibility.visible`, and
 * its image has uploaded. Membership transitions are driven by
 * `Changed<ViewVisibility>` (visibility flips, which also cover spawn-into-visible
 * since the cull flips a fresh entity false→true the same frame) and the removed
 * buffer (despawn / `Sprite` removal); slot bytes are repacked on
 * `Changed<GlobalTransform>` / `Changed<Sprite>` (atlas UV edits surface as the
 * latter, so animation flows through the same gate). A static scene does O(0)
 * work; a moving scene does O(changed). The {@link SortedSlotIndex} re-sorts only
 * when membership or a sort key actually changed.
 *
 * Queries the main `world` directly with a self-managed since-tick rather than
 * an `Extract(Query(..., { changed }))` param: render-stage params carry the
 * render world's tick, not the main world's, so a changed-gated Extract query
 * would compare ticks across worlds. This mirrors how `propagateTransformsGated`
 * consumes change detection.
 */
export const prepareSpritesRetained = (
  world: World,
  renderer: Renderer,
  retained: RetainedSpriteBuffer,
  images: Images,
  renderImages: RenderImages,
): void => {
  const tickNow = world.changeTick;
  const since = retained.lastPrepareTick;
  const { slotBuf, index, pending } = retained;
  const slots = slotBuf.slots;
  const newThisFrame = retained.newThisFrame;
  const packEntities = retained.packEntities;
  const packSprites = retained.packSprites;
  const packGts = retained.packGts;
  newThisFrame.clear();
  packEntities.length = 0;
  packSprites.length = 0;
  packGts.length = 0;

  const resolveHandle = (sprite: Sprite): ImageHandle =>
    sprite.image !== undefined ? sprite.image : images.WHITE;

  const drop = (entity: Entity): void => {
    if (slots.get(entity) !== undefined) {
      slots.free(entity);
      index.removeMember(entity);
    }
    pending.delete(entity);
  };

  // Queue an alloc/re-length + pack for a now-eligible sprite. `newThisFrame`
  // marks slots that need addMember (fresh / re-allocated) vs updateMember.
  const admit = (entity: Entity, sprite: Sprite, gt: GlobalTransform): void => {
    const len = instanceCountForSprite(sprite);
    const existing = slots.get(entity);
    if (existing === undefined) {
      slots.alloc(entity, len);
      newThisFrame.add(entity);
    } else if (existing.len !== len) {
      // Plain ↔ 9-slice toggle: drop and re-allocate, treat as fresh in the index.
      index.removeMember(entity);
      slots.alloc(entity, len);
      newThisFrame.add(entity);
    }
    packEntities.push(entity);
    packSprites.push(sprite);
    packGts.push(gt);
  };

  // 1. Visibility transitions (and spawn-into-visible): only entities whose
  //    ViewVisibility actually flipped since the last prepare.
  for (const row of world
    .query([Sprite, GlobalTransform, ViewVisibility], { changed: [ViewVisibility] }, since)
    .entries()) {
    const entity = row[0] as Entity;
    const sprite = row[1] as Sprite;
    const gt = row[2] as GlobalTransform;
    const vis = row[3] as ViewVisibility;
    if (!vis.visible) {
      drop(entity);
    } else if (renderImages.get(resolveHandle(sprite)) !== undefined) {
      pending.delete(entity);
      admit(entity, sprite, gt);
    } else {
      // Visible but the image isn't uploaded yet — park it (free any stale slot).
      if (slots.get(entity) !== undefined) {
        slots.free(entity);
        index.removeMember(entity);
      }
      pending.add(entity);
    }
  }

  // 2. Despawns / Sprite removals: free the slot, regardless of visibility.
  for (const { entity, tick } of world.getRemovedComponents(Sprite)) {
    if (tick > since) drop(entity);
  }

  // 3. Pending drain (residual O(k); k → 0 once a static scene's images upload).
  for (const entity of pending) {
    const vis = world.getComponent(entity, ViewVisibility);
    if (vis === undefined || !vis.visible) {
      pending.delete(entity);
      continue;
    }
    const sprite = world.getComponent(entity, Sprite);
    const gt = world.getComponent(entity, GlobalTransform);
    if (sprite === undefined || gt === undefined) {
      pending.delete(entity);
      continue;
    }
    if (renderImages.get(resolveHandle(sprite)) !== undefined) {
      pending.delete(entity);
      admit(entity, sprite, gt);
    }
  }

  // 4. Data changes: repack slotted sprites whose GlobalTransform or Sprite
  //    changed. Skip entities packed fresh this frame, and those without a slot
  //    (pending / invisible — they pack at their current state when admitted).
  const changed = retained.changed;
  changed.clear();
  const repack = (row: readonly unknown[]): void => {
    const entity = row[0] as Entity;
    if (changed.has(entity) || newThisFrame.has(entity)) return;
    changed.add(entity);
    if (slots.get(entity) === undefined) return;
    admit(entity, row[1] as Sprite, row[2] as GlobalTransform);
  };
  for (const row of world
    .query([Sprite, GlobalTransform, ViewVisibility], { changed: [GlobalTransform] }, since)
    .entries()) {
    repack(row);
  }
  for (const row of world
    .query([Sprite, GlobalTransform, ViewVisibility], { changed: [Sprite] }, since)
    .entries()) {
    repack(row);
  }

  // 5. Grow the slot scratch to the finalized capacity, then pack the queued
  //    sprites into their stable slots and (re)register them with the index.
  slotBuf.ensureCapacity(renderer);
  for (let i = 0; i < packEntities.length; i++) {
    const entity = packEntities[i]!;
    const sprite = packSprites[i]!;
    const gt = packGts[i]!;
    const slot = slots.get(entity)!;
    const resolvedHandle = resolveHandle(sprite);
    const source = images.get(resolvedHandle);
    const imageSize =
      source !== undefined ? { width: source.width, height: source.height } : { width: 1, height: 1 };
    packSpriteInstance(
      sprite,
      gt.matrix as Mat4,
      imageSize,
      slotBuf.scratchF32,
      slotBuf.scratchU32,
      slotBuf.floatOffsetOf(slot.first),
    );
    const isOpaque = (sprite.color[3] as number) >= 1;
    const key: SpriteSortKey = {
      bucketKey: isOpaque ? 0 : 1,
      bucket: isOpaque ? 'opaque' : 'blend',
      worldZ: gt.matrix[14] as number,
      imageHandle: resolvedHandle,
    };
    if (newThisFrame.has(entity)) index.addMember(entity, slot, key);
    else index.updateMember(entity, key, slotBuf.store);
  }

  // 6. Reclaim fragmentation when holes dominate (rare; never on a static scene).
  if (slots.fragmentation() > COMPACT_FRAGMENTATION && slots.freeInstances > COMPACT_MIN_FREE) {
    slotBuf.compact();
    index.invalidate();
  }

  // 7. Rebuild the ordered buffer if invalidated, else upload only the in-place edits.
  index.prepare(slotBuf.store, renderer);

  retained.lastPrepareTick = tickNow;
};

/**
 * Queue counterpart to {@link prepareSpritesRetained}: walks the retained ordered
 * batches × active 2D cameras and pushes one `PhaseItem2d` per `(camera, batch)`,
 * reading the ordered GPU buffer the index owns. Routing, per-camera sort depth,
 * and the draw shape match the legacy `queueSprites` exactly.
 */
export const queueSpritesRetained = (
  app: App,
  cameras: SortedCameras,
  images: Images,
  renderImages: RenderImages,
  pipeline: SpritePipeline,
  retained: RetainedSpriteBuffer,
  phases: ViewPhases2d,
): void => {
  const batches = retained.index.batches;
  if (batches.length === 0) return;
  if (!pipeline.ensureInitialised(app)) return;
  const quadVertex = pipeline.quadVertexBuffer;
  const quadIndex = pipeline.quadIndexBuffer;
  const specialized = pipeline.specialized;
  const instanceBufferGpu = retained.index.ordered.buffer;
  if (
    quadVertex === undefined ||
    quadIndex === undefined ||
    specialized === undefined ||
    instanceBufferGpu === undefined
  ) {
    return;
  }
  for (const view of cameras.views) {
    if (view.subGraph !== Core2dLabel) continue;
    const v = view.viewMatrix as Float32Array;
    for (const batch of batches) {
      const { imageHandle, bucket, worldZ } = batch.key;
      const bindGroup = pipeline.bindGroupFor(imageHandle, images, renderImages, app.renderer);
      if (bindGroup === undefined) continue;
      const renderPipeline = specialized.get({
        key: { surfaceFormat: view.mainColorTarget.format, msaaSamples: 1, hdr: view.hdr, alphaBucket: bucket },
      });
      const sortDepth = (v[10] as number) * worldZ + (v[14] as number);
      const { firstInstance, count } = batch;
      const draw = (pass: RenderPassEncoder, _ctx: RenderContext): void => {
        pass.setPipeline(renderPipeline);
        pass.setBindGroup(1, bindGroup);
        pass.setVertexBuffer(0, quadVertex);
        pass.setVertexBuffer(1, instanceBufferGpu);
        pass.setIndexBuffer(quadIndex, 'uint16');
        pass.drawIndexed(6, count, 0, 0, firstInstance);
      };
      const item: PhaseItem2d = { sourceEntity: view.sourceEntity, sortDepth, draw };
      if (bucket === 'opaque') phases.pushOpaque(view.sourceEntity, item);
      else phases.pushTransparent(view.sourceEntity, item);
    }
  }
};
