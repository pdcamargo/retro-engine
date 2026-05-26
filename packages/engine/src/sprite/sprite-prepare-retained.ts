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

  readonly seen = new Set<Entity>();
  readonly newThisFrame = new Set<Entity>();
  readonly changed = new Set<Entity>();
  readonly packEntities: Entity[] = [];
  readonly packSprites: Sprite[] = [];
  readonly packGts: GlobalTransform[] = [];
  readonly freeList: Entity[] = [];

  dispose(): void {
    this.slotBuf.dispose();
    this.index.dispose();
  }
}

/**
 * Change-gated retained sprite prepare.
 *
 * Replaces the per-frame full repack with O(changed) work: only sprites whose
 * `GlobalTransform` or `Sprite` changed since {@link RetainedSpriteBuffer.lastPrepareTick}
 * are repacked, and the {@link SortedSlotIndex} re-sorts only when membership or
 * a sort key actually changed. Atlas-driven UV updates surface as
 * `Changed<Sprite>` (atlas-sync marks it), so animation flows through the same
 * gate; because it leaves world Z untouched, it never invalidates the sort —
 * just rewrites the changed sprites' instance bytes.
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
  const { slotBuf, index } = retained;
  const slots = slotBuf.slots;

  // 1. Data-changed set: union of Changed<GlobalTransform> and Changed<Sprite>.
  const changed = retained.changed;
  changed.clear();
  for (const row of world
    .query([Sprite, GlobalTransform, ViewVisibility], { changed: [GlobalTransform] }, since)
    .entries()) {
    changed.add(row[0] as Entity);
  }
  for (const row of world
    .query([Sprite, GlobalTransform, ViewVisibility], { changed: [Sprite] }, since)
    .entries()) {
    changed.add(row[0] as Entity);
  }

  // 2. Structural walk over every visible sprite: allocate slots for spawns /
  //    visibility-on flips / re-lengths, and queue the spawned + changed sprites
  //    for packing. Capturing the component refs here avoids a second lookup.
  const seen = retained.seen;
  const newThisFrame = retained.newThisFrame;
  const packEntities = retained.packEntities;
  const packSprites = retained.packSprites;
  const packGts = retained.packGts;
  seen.clear();
  newThisFrame.clear();
  packEntities.length = 0;
  packSprites.length = 0;
  packGts.length = 0;

  world.query([Sprite, GlobalTransform, ViewVisibility]).forEach((row) => {
    const entity = row[0] as Entity;
    const sprite = row[1] as Sprite;
    const gt = row[2] as GlobalTransform;
    const vis = row[3] as ViewVisibility;
    if (!vis.visible) return;
    const resolvedHandle = sprite.image !== undefined ? sprite.image : images.WHITE;
    if (renderImages.get(resolvedHandle) === undefined) return; // image not uploaded yet
    seen.add(entity);

    const len = instanceCountForSprite(sprite);
    const existing = slots.get(entity);
    let needsPack: boolean;
    if (existing === undefined) {
      slots.alloc(entity, len);
      newThisFrame.add(entity);
      needsPack = true;
    } else if (existing.len !== len) {
      // Plain ↔ 9-slice toggle: drop and re-allocate, treat as fresh in the index.
      index.removeMember(entity);
      slots.alloc(entity, len);
      newThisFrame.add(entity);
      needsPack = true;
    } else {
      needsPack = changed.has(entity);
    }
    if (needsPack) {
      packEntities.push(entity);
      packSprites.push(sprite);
      packGts.push(gt);
    }
  });

  // 3. Grow the slot scratch to the finalized capacity, then pack the queued
  //    sprites into their stable slots and (re)register them with the index.
  slotBuf.ensureCapacity(renderer);
  for (let i = 0; i < packEntities.length; i++) {
    const entity = packEntities[i]!;
    const sprite = packSprites[i]!;
    const gt = packGts[i]!;
    const slot = slots.get(entity)!;
    const resolvedHandle = sprite.image !== undefined ? sprite.image : images.WHITE;
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

  // 4. Sweep despawned / now-invisible sprites (only when the live count fell).
  if (seen.size !== slots.size) {
    const freeList = retained.freeList;
    freeList.length = 0;
    for (const [entity] of slots.entries()) {
      if (!seen.has(entity)) freeList.push(entity);
    }
    for (const entity of freeList) {
      slots.free(entity);
      index.removeMember(entity);
    }
  }

  // 5. Reclaim fragmentation when holes dominate (rare; never on a static scene).
  if (slots.fragmentation() > COMPACT_FRAGMENTATION && slots.freeInstances > COMPACT_MIN_FREE) {
    slotBuf.compact();
    index.invalidate();
  }

  // 6. Rebuild the ordered buffer if invalidated, else upload only the in-place edits.
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
        key: { surfaceFormat: view.target.format, msaaSamples: 1, hdr: false, alphaBucket: bucket },
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
