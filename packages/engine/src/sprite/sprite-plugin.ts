import type { Entity, Query as QueryHandle } from '@retro-engine/ecs';
import type { RenderPassEncoder } from '@retro-engine/renderer-core';

import { SortedCameras } from '../camera/sorted-cameras';
import { Images } from '../image/images';
import { RenderImages } from '../image/image-plugin';
import type { App, RenderContext } from '../index';
import type { PluginObject } from '../plugin';
import { Core2dLabel } from '../render-graph/core-2d';
import type { PhaseItem2d } from '../render-graph/phase-2d';
import { ViewPhases2d } from '../render-graph/phase-2d';
import { RenderSet } from '../render-set';
import { ShaderRegistry } from '../shader/shader-registry';
import { Extract, Query, Res, ResMut } from '../system-param';
import { Time } from '../time';
import { GlobalTransform } from '../transform';
import { NoFrustumCulling, ViewVisibility } from '../visibility/visibility';

import { AtlasAnimation, atlasAnimationSystem } from './atlas-animation';
import { atlasSyncSystem } from './atlas-sync';
import { calculateSpriteBoundsSystem } from './calculate-sprite-bounds';
import { Sprite } from './sprite';
import {
  type SpriteAlphaBucket,
  SpritePreparedBatches,
} from './sprite-batch';
import {
  instanceCountForSprite,
  type PerSpriteEntry,
  sortAndEmitSpriteBatches,
} from './sprite-batch-prepare';
import { SpriteInstanceBuffer } from './sprite-instance-buffer';
import { SpritePipeline } from './sprite-pipeline';
import { SPRITE_WGSL } from './sprite.wgsl';
import { TextureAtlas } from './texture-atlas';
import { TextureAtlasLayouts } from './texture-atlas-layouts';

/**
 * Engine plugin owning the built-in batched sprite pipeline.
 *
 * On `build`:
 *
 * - Registers the `retro_engine::sprite` WGSL module against `ShaderRegistry`
 *   (idempotent — re-registration replaces the prior source).
 * - Inserts {@link SpritePipeline}, {@link SpriteInstanceBuffer},
 *   {@link SpritePreparedBatches}, and {@link ViewPhases2d} as render-world
 *   resources (idempotent — the latter is also installed by
 *   `RenderGraphPlugin`).
 * - Registers `RenderSet.Prepare` system `'sprite-prepare'` (`after:
 *   ['image-prepare']`): iterates visible `(Sprite + GlobalTransform +
 *   ViewVisibility)` entities, packs per-instance data into the shared
 *   scratch + uploads in one `renderer.writeBuffer`, groups into batches.
 * - Registers `RenderSet.Queue` system `'sprite-queue'`: iterates batches ×
 *   active 2D cameras and pushes one `PhaseItem2d` per `(camera, batch)`,
 *   routing to opaque vs transparent based on the batch's alpha bucket.
 * - Inserts {@link TextureAtlasLayouts} as a main-world resource and registers
 *   three `'postUpdate'` systems: `'atlas-animation'` (advances
 *   `TextureAtlas.index` over time for entities carrying an `AtlasAnimation`,
 *   ordered before `'atlas-sync'` so the new index propagates in the same
 *   frame), `'atlas-sync'` (writes `sprite.rect` from `(layout, index)` for
 *   entities whose `TextureAtlas` changed), and `'sprite-bounds'` (auto-AABB
 *   for sprite frustum culling, ordered after `'atlas-sync'` so atlassed
 *   sprites have an up-to-date rect first).
 *
 * Unique — only one sprite pipeline ships with the engine. Custom 2D
 * materials (`Material2d`, Phase 8.7) use a separate plugin and share the
 * same `ViewPhases2d` resource.
 */
export class SpritePlugin implements PluginObject {
  name(): string {
    return 'SpritePlugin';
  }

  build(app: App): void {
    const registry = app.getResource(ShaderRegistry);
    if (registry === undefined) {
      throw new Error(
        'SpritePlugin: ShaderRegistry resource missing; ShaderPlugin must run before SpritePlugin.',
      );
    }
    if (!registry.has('retro_engine::sprite')) {
      registry.register('retro_engine::sprite', SPRITE_WGSL);
    }
    if (app.getResource(SpritePipeline) === undefined) {
      app.insertResource(new SpritePipeline());
    }
    if (app.getResource(SpriteInstanceBuffer) === undefined) {
      app.insertResource(new SpriteInstanceBuffer());
    }
    if (app.getResource(SpritePreparedBatches) === undefined) {
      app.insertResource(new SpritePreparedBatches());
    }
    if (app.getResource(ViewPhases2d) === undefined) {
      app.insertResource(new ViewPhases2d());
    }
    if (app.getResource(TextureAtlasLayouts) === undefined) {
      app.insertResource(new TextureAtlasLayouts());
    }

    // `'postUpdate'` chain for atlas-driven sprites:
    //   atlas-animation advances TextureAtlas.index over time
    //   ↓
    //   atlas-sync writes sprite.rect from (layout, index)
    //   ↓
    //   sprite-bounds computes Aabb from sprite footprint (uses up-to-date rect)
    //   ↓
    //   downstream visibility pipeline picks up Aabb (CalculateBounds slot is
    //   the head of VisibilityPlugin's documented order).
    type AtlasAnimationQuery = QueryHandle<
      readonly [typeof AtlasAnimation, typeof TextureAtlas]
    >;
    type AtlasSyncQuery = QueryHandle<
      readonly [typeof Sprite, typeof TextureAtlas],
      { changed: readonly (typeof TextureAtlas)[] }
    >;
    type SpriteBoundsQuery = QueryHandle<
      readonly [typeof Sprite],
      { without: readonly (typeof NoFrustumCulling)[] }
    >;

    app.addSystem(
      'postUpdate',
      [Res(Time), Query([AtlasAnimation, TextureAtlas])],
      (time, animated) => {
        atlasAnimationSystem(
          time as Time,
          animated as unknown as AtlasAnimationQuery,
          app.world,
        );
      },
      { label: 'atlas-animation', before: ['atlas-sync'] },
    );

    app.addSystem(
      'postUpdate',
      [
        Res(TextureAtlasLayouts),
        Query([Sprite, TextureAtlas], { changed: [TextureAtlas] }),
      ],
      (layouts, atlassed) => {
        atlasSyncSystem(
          layouts as TextureAtlasLayouts,
          atlassed as unknown as AtlasSyncQuery,
          app.world,
        );
      },
      { label: 'atlas-sync' },
    );

    app.addSystem(
      'postUpdate',
      [
        Res(TextureAtlasLayouts),
        Res(Images),
        Query([Sprite], { without: [NoFrustumCulling] }),
      ],
      (layouts, images, spritesQ) => {
        calculateSpriteBoundsSystem(
          layouts as TextureAtlasLayouts,
          images as Images,
          spritesQ as unknown as SpriteBoundsQuery,
          app.world,
        );
      },
      { label: 'sprite-bounds', after: ['atlas-sync'] },
    );

    type SpriteQuery = QueryHandle<
      readonly [typeof Sprite, typeof GlobalTransform, typeof ViewVisibility]
    >;

    app.addSystem(
      'render',
      [
        Extract(Query([Sprite, GlobalTransform, ViewVisibility])),
        Res(Images),
        Res(RenderImages),
        ResMut(SpritePipeline),
        ResMut(SpriteInstanceBuffer),
        ResMut(SpritePreparedBatches),
      ],
      (
        sprites,
        images,
        renderImages,
        pipeline,
        instanceBuffer,
        prepared,
      ) => {
        prepared.batches.length = 0;
        instanceBuffer.count = 0;

        const ready = (pipeline as SpritePipeline).ensureInitialised(app);
        if (!ready) return;

        prepareSprites(
          app,
          sprites as unknown as SpriteQuery,
          images as Images,
          renderImages as RenderImages,
          instanceBuffer as SpriteInstanceBuffer,
          prepared as SpritePreparedBatches,
        );
      },
      { set: RenderSet.Prepare, label: 'sprite-prepare', after: ['image-prepare'] },
    );

    app.addSystem(
      'render',
      [
        Res(SortedCameras),
        Res(Images),
        Res(RenderImages),
        ResMut(SpritePipeline),
        ResMut(SpriteInstanceBuffer),
        ResMut(SpritePreparedBatches),
        ResMut(ViewPhases2d),
      ],
      (
        cameras,
        images,
        renderImages,
        pipeline,
        instanceBuffer,
        prepared,
        phases,
      ) => {
        queueSprites(
          app,
          cameras as unknown as SortedCameras,
          images as Images,
          renderImages as RenderImages,
          pipeline as SpritePipeline,
          instanceBuffer as SpriteInstanceBuffer,
          prepared as SpritePreparedBatches,
          phases,
        );
      },
      { set: RenderSet.Queue, label: 'sprite-queue', after: ['sprite-prepare'] },
    );
  }
}

const prepareSprites = (
  app: App,
  sprites: QueryHandle<readonly [typeof Sprite, typeof GlobalTransform, typeof ViewVisibility]>,
  images: Images,
  renderImages: RenderImages,
  instanceBuffer: SpriteInstanceBuffer,
  prepared: SpritePreparedBatches,
): void => {
  // Gather visible sprites first. Skip entities whose source image hasn't been
  // uploaded yet (a freshly added handle that race-conditions the prepare
  // ordering); they'll be picked up next frame.
  const entries: PerSpriteEntry[] = [];
  for (const row of sprites.entries()) {
    const entity = row[0] as Entity;
    const sprite = row[1] as Sprite;
    const gt = row[2] as GlobalTransform;
    const vis = row[3] as ViewVisibility;
    if (!vis.visible) continue;
    const resolvedHandle = sprite.image !== undefined ? sprite.image : images.WHITE;
    if (renderImages.get(resolvedHandle) === undefined) continue;
    const isOpaque = (sprite.color[3] as number) >= 1;
    const bucket: SpriteAlphaBucket = isOpaque ? 'opaque' : 'blend';
    const bucketKey: 0 | 1 = isOpaque ? 0 : 1;
    const worldZ = gt.matrix[14] as number;
    entries.push({ entity, sprite, gt, bucket, bucketKey, imageHandle: resolvedHandle, worldZ });
  }
  if (entries.length === 0) return;

  // Grow the instance buffer to fit every visible sprite. A 9-sliced sprite
  // contributes 9 instances; the default single-quad path contributes 1. The
  // pre-count walk is cheaper than over-allocating 9× upfront when the scene
  // is mostly plain sprites with a few 9-slice panels.
  let totalInstances = 0;
  for (const e of entries) {
    totalInstances += instanceCountForSprite(e.sprite);
  }
  instanceBuffer.ensureCapacity(app.renderer, totalInstances);

  // Sort by (bucket, -worldZ, image) and walk-emit batches. Within each
  // bucket the back-most sprite lands first; consecutive entries that share
  // (image, bucket) collapse into one batch. Sprites in foreign images at
  // intervening Z values break the run automatically.
  const { cursorFloats, cursorInstances } = sortAndEmitSpriteBatches(
    entries,
    images,
    instanceBuffer.scratchF32,
    instanceBuffer.scratchU32,
    prepared.batches,
  );

  instanceBuffer.count = cursorInstances;
  // Single per-frame upload. The packed scratch is sized >= byteLength; write
  // exactly what we wrote. The cast widens `Float32Array<ArrayBufferLike>` to
  // `BufferSource` — `subarray` always returns a view over the same
  // (non-shared) `ArrayBuffer` we allocated in `sprite-instance-buffer.ts`.
  if (cursorFloats > 0 && instanceBuffer.buffer !== undefined) {
    const view = instanceBuffer.scratchF32.subarray(0, cursorFloats);
    app.renderer.writeBuffer(instanceBuffer.buffer, 0, view as unknown as BufferSource);
  }
};

const queueSprites = (
  app: App,
  cameras: SortedCameras,
  images: Images,
  renderImages: RenderImages,
  pipeline: SpritePipeline,
  instanceBuffer: SpriteInstanceBuffer,
  prepared: SpritePreparedBatches,
  phases: ViewPhases2d,
): void => {
  if (prepared.batches.length === 0) return;
  const ready = pipeline.ensureInitialised(app);
  if (!ready) return;
  const quadVertex = pipeline.quadVertexBuffer;
  const quadIndex = pipeline.quadIndexBuffer;
  const specialized = pipeline.specialized;
  const instanceBufferGpu = instanceBuffer.buffer;
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
    for (const batch of prepared.batches) {
      const bindGroup = pipeline.bindGroupFor(batch.image, images, renderImages, app.renderer);
      if (bindGroup === undefined) continue;
      const surfaceFormat = view.target.format;
      const renderPipeline = specialized.get({
        key: {
          surfaceFormat,
          msaaSamples: 1,
          hdr: false,
          alphaBucket: batch.bucket,
        },
      });
      // Camera-space Z of the batch origin. 2D cameras are axis-aligned in
      // practice (the orthographic projection points the camera straight
      // along -Z), so only the world Z component drives the sort key. The
      // `v[10] * worldZ + v[14]` formula is the Z-only specialization of
      // `MaterialPlugin`'s full `v[2]*wx + v[6]*wy + v[10]*wz + v[14]`
      // (the wx / wy terms vanish when v[2] = v[6] = 0). The batch's
      // `worldZ` is the Z of its first sprite — per-sprite Z would require
      // per-sprite phase items.
      const sortDepth = (v[10] as number) * batch.worldZ + (v[14] as number);
      const firstInstance = batch.firstInstance;
      const count = batch.count;
      const draw = (pass: RenderPassEncoder, _ctx: RenderContext): void => {
        pass.setPipeline(renderPipeline);
        pass.setBindGroup(1, bindGroup);
        pass.setVertexBuffer(0, quadVertex);
        pass.setVertexBuffer(1, instanceBufferGpu);
        pass.setIndexBuffer(quadIndex, 'uint16');
        pass.drawIndexed(6, count, 0, 0, firstInstance);
      };
      const item: PhaseItem2d = {
        sourceEntity: view.sourceEntity,
        sortDepth,
        draw,
      };
      if (batch.bucket === 'opaque') {
        phases.pushOpaque(view.sourceEntity, item);
      } else {
        phases.pushTransparent(view.sourceEntity, item);
      }
    }
  }
};

