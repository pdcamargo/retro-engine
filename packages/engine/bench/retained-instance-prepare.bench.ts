// Retained instance preparation — full per-frame rebuild vs change-gated
// incremental, across instance counts and dirty-set ratios. See docs/adr/ADR-0039.
//
// The legacy prepare re-sorts + re-packs every visible instance each frame
// (`packInstancedBatches` / `sortAndEmitSpriteBatches`); the retained path keeps
// the slot bytes and sorted draw order across frames, re-packing only the
// changed slots and copying them into the ordered buffer. This bench fixtures
// the sort/pack/copy core directly — no App / ECS / GPU upload — so the
// measurement isolates the algorithmic difference: O(n) every frame vs
// O(changed). Both the 128-byte mesh stride and the 44-byte sprite stride are
// measured.

import { bench, summary } from 'mitata';

import { asAssetIndex, makeHandle } from '@retro-engine/assets';
import type { Entity } from '@retro-engine/ecs';
import { mat4, vec2 } from '@retro-engine/math';

import { GrowableInstanceStore } from '../src/instance/growable-instance-store';
import { SortedSlotIndex } from '../src/instance/retained-draw-order';
import type { Slot } from '../src/instance/retained-slot-map';
import {
  type AlphaBucket,
  type InstanceEntry,
  type InstancedDrawPayload,
  packInstancedBatches,
} from '../src/material/instance-batching';
import {
  MESH_INSTANCE_BYTE_SIZE,
  MESH_INSTANCE_FLOAT_COUNT,
  packInstanceTransform,
} from '../src/material/instance-layout';
import { Sprite } from '../src/sprite/sprite';
import {
  packSpriteInstance,
  SPRITE_INSTANCE_BYTE_SIZE,
  SPRITE_INSTANCE_FLOAT_COUNT,
} from '../src/sprite/sprite-batch';
import type { PerSpriteEntry, SpriteImageSizeLookup } from '../src/sprite/sprite-batch-prepare';
import { sortAndEmitSpriteBatches } from '../src/sprite/sprite-batch-prepare';

import { makeRenderingBenchRenderer } from './helpers';

const COUNTS = [1_000, 8_000] as const;
const DIRTY_PCTS = [0, 10, 100] as const;
const MODEL = mat4.identity();
const renderer = makeRenderingBenchRenderer();

// ---------------------------------------------------------------------------
// Mesh (128-byte instance: model + inverse-transpose). 3D opaque is free-grouped.
// ---------------------------------------------------------------------------

const FREE = new Set<AlphaBucket>(['blend']); // opaque not in the set → grouped freely
const PAYLOAD = {} as unknown as InstancedDrawPayload;
const MATERIAL_HANDLE = makeHandle(asAssetIndex(0)) as InstanceEntry['materialHandle'];

interface MeshKey {
  readonly groupKey: string;
}
const meshCompare = (a: MeshKey, b: MeshKey): number =>
  a.groupKey < b.groupKey ? -1 : a.groupKey > b.groupKey ? 1 : 0;
const meshSameBatch = (a: MeshKey, b: MeshKey): boolean => a.groupKey === b.groupKey;

const buildMeshEntries = (count: number): InstanceEntry[] => {
  const entries: InstanceEntry[] = [];
  for (let i = 0; i < count; i++) {
    entries.push({ cameraEntity: 1, bucket: 'opaque', groupKey: `${i % 8}`, materialHandle: MATERIAL_HANDLE, depth: i, model: MODEL, payload: PAYLOAD });
  }
  return entries;
};

interface MeshState {
  index: SortedSlotIndex<MeshKey>;
  source: GrowableInstanceStore;
  keys: MeshKey[];
  count: number;
}
const buildMeshRetained = (count: number): MeshState => {
  const source = new GrowableInstanceStore(MESH_INSTANCE_BYTE_SIZE, 'mesh-slot');
  source.ensureScratch(count);
  const index = new SortedSlotIndex<MeshKey>(MESH_INSTANCE_BYTE_SIZE, 'mesh-ordered', meshCompare, meshSameBatch);
  const keys: MeshKey[] = [];
  for (let i = 0; i < count; i++) {
    packInstanceTransform(source.scratchF32, source.floatOffsetOf(i), MODEL);
    const key: MeshKey = { groupKey: `${i % 8}` };
    keys.push(key);
    index.addMember(i as Entity, { first: i, len: 1 } as Slot, key);
  }
  index.prepare(source, renderer); // warm: initial sort + full seed
  return { index, source, keys, count };
};

const meshRetainedFrame = (s: MeshState, pct: number): void => {
  const dirty = Math.floor((s.count * pct) / 100);
  for (let i = 0; i < dirty; i++) {
    packInstanceTransform(s.source.scratchF32, s.source.floatOffsetOf(i), MODEL);
    s.index.updateMember(i as Entity, s.keys[i]!, s.source); // same key → in-place copy
  }
  s.index.prepare(s.source, renderer);
};

for (const count of COUNTS) {
  const entries = buildMeshEntries(count);
  const scratch = new Float32Array(count * MESH_INSTANCE_FLOAT_COUNT);
  summary(() => {
    bench(`mesh full-rebuild @ ${count}`, () => {
      packInstancedBatches(entries.slice(), FREE, scratch);
    });
    for (const pct of DIRTY_PCTS) {
      bench(`mesh retained @ ${count} @ ${pct}% dirty`, function* () {
        const state = buildMeshRetained(count);
        yield () => meshRetainedFrame(state, pct);
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Sprite (44-byte instance). All 2D buckets are depth-ordered.
// ---------------------------------------------------------------------------

const IMAGE_SIZE: SpriteImageSizeLookup = { get: () => ({ width: 16, height: 16 }) };

interface SpriteKey {
  readonly bucketKey: 0 | 1;
  readonly worldZ: number;
  readonly image: number;
}
const spriteCompare = (a: SpriteKey, b: SpriteKey): number => {
  if (a.bucketKey !== b.bucketKey) return a.bucketKey - b.bucketKey;
  if (a.worldZ !== b.worldZ) return b.worldZ - a.worldZ;
  return a.image - b.image;
};
const spriteSameBatch = (a: SpriteKey, b: SpriteKey): boolean =>
  a.image === b.image && a.bucketKey === b.bucketKey;

const makeSprite = (): Sprite => new Sprite({ customSize: vec2.create(8, 8) });

const buildSpriteEntries = (count: number): PerSpriteEntry[] => {
  const entries: PerSpriteEntry[] = [];
  const sprite = makeSprite();
  for (let i = 0; i < count; i++) {
    entries.push({
      entity: i as Entity,
      sprite,
      gt: { matrix: mat4.identity() } as PerSpriteEntry['gt'],
      bucket: 'opaque',
      bucketKey: 0,
      imageHandle: makeHandle(asAssetIndex(i % 8)) as PerSpriteEntry['imageHandle'],
      worldZ: i,
    });
  }
  return entries;
};

interface SpriteState {
  index: SortedSlotIndex<SpriteKey>;
  source: GrowableInstanceStore;
  sprite: Sprite;
  keys: SpriteKey[];
  count: number;
}
const buildSpriteRetained = (count: number): SpriteState => {
  const source = new GrowableInstanceStore(SPRITE_INSTANCE_BYTE_SIZE, 'sprite-slot');
  source.ensureScratch(count);
  const index = new SortedSlotIndex<SpriteKey>(SPRITE_INSTANCE_BYTE_SIZE, 'sprite-ordered', spriteCompare, spriteSameBatch);
  const sprite = makeSprite();
  const keys: SpriteKey[] = [];
  for (let i = 0; i < count; i++) {
    packSpriteInstance(sprite, mat4.identity(), { width: 16, height: 16 }, source.scratchF32, source.scratchU32, source.floatOffsetOf(i));
    const key: SpriteKey = { bucketKey: 0, worldZ: i, image: i % 8 };
    keys.push(key);
    index.addMember(i as Entity, { first: i, len: 1 } as Slot, key);
  }
  index.prepare(source, renderer);
  return { index, source, sprite, keys, count };
};

const spriteRetainedFrame = (s: SpriteState, pct: number): void => {
  const dirty = Math.floor((s.count * pct) / 100);
  for (let i = 0; i < dirty; i++) {
    packSpriteInstance(s.sprite, mat4.identity(), { width: 16, height: 16 }, s.source.scratchF32, s.source.scratchU32, s.source.floatOffsetOf(i));
    s.index.updateMember(i as Entity, s.keys[i]!, s.source);
  }
  s.index.prepare(s.source, renderer);
};

for (const count of COUNTS) {
  const entries = buildSpriteEntries(count);
  const f32 = new Float32Array(count * SPRITE_INSTANCE_FLOAT_COUNT);
  const u32 = new Uint32Array(f32.buffer);
  summary(() => {
    bench(`sprite full-rebuild @ ${count}`, () => {
      sortAndEmitSpriteBatches(entries.slice(), IMAGE_SIZE, f32, u32, []);
    });
    for (const pct of DIRTY_PCTS) {
      bench(`sprite retained @ ${count} @ ${pct}% dirty`, function* () {
        const state = buildSpriteRetained(count);
        yield () => spriteRetainedFrame(state, pct);
      });
    }
  });
}
