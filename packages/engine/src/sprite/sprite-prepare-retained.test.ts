import { describe, expect, it } from 'bun:test';

import type { Entity } from '@retro-engine/ecs';
import { vec2, vec3, vec4 } from '@retro-engine/math';

import { App, Camera2d, Image, Images, SPRITE_INSTANCE_FLOAT_COUNT, Sprite, Transform } from '../index';
import { makeCapturingRenderer, makeRenderingRenderer, makeStubCanvas } from '../test-utils';

import { SPRITE_INSTANCE_BYTE_SIZE, SpritePreparedBatches } from './sprite-batch';
import { SpriteInstanceBuffer } from './sprite-instance-buffer';
import { SpritePlugin } from './sprite-plugin';
import { RetainedSpriteBuffer } from './sprite-prepare-retained';

type Spawn = (app: App, images: Images) => void;

const buildApp = async (retained: boolean, spawn: Spawn): Promise<App> => {
  const { renderer } = makeCapturingRenderer();
  const app = new App({ renderer, canvas: makeStubCanvas() });
  app.addPlugin(new SpritePlugin({ retained }));
  const images = app.getResource(Images)!;
  spawn(app, images);
  app.world.spawn(...Camera2d());
  await app.run();
  app.stop();
  return app;
};

interface PrepState {
  count: number;
  /** Packed instance words in draw order (u32 view → bit-exact, no NaN hazard). */
  words: number[];
  batches: Array<{ first: number; count: number; bucket: string }>;
}

const legacyState = (app: App): PrepState => {
  const buf = app.getResource(SpriteInstanceBuffer)!;
  const prepared = app.getResource(SpritePreparedBatches)!;
  return {
    count: buf.count,
    words: Array.from(buf.scratchU32.subarray(0, buf.count * SPRITE_INSTANCE_FLOAT_COUNT)),
    batches: prepared.batches.map((b) => ({ first: b.firstInstance, count: b.count, bucket: b.bucket })),
  };
};

const retainedStateOf = (app: App): PrepState => {
  const r = app.getResource(RetainedSpriteBuffer)!;
  const batches = r.index.batches;
  const count = batches.reduce((s, b) => s + b.count, 0);
  return {
    count,
    words: Array.from(r.index.ordered.scratchU32.subarray(0, count * SPRITE_INSTANCE_FLOAT_COUNT)),
    batches: batches.map((b) => ({ first: b.firstInstance, count: b.count, bucket: b.key.bucket })),
  };
};

const expectParity = async (spawn: Spawn): Promise<void> => {
  const legacy = legacyState(await buildApp(false, spawn));
  const retained = retainedStateOf(await buildApp(true, spawn));
  expect(retained.count).toBe(legacy.count);
  expect(retained.batches).toEqual(legacy.batches);
  expect(retained.words).toEqual(legacy.words);
};

describe('prepareSpritesRetained — parity with the legacy full-rebuild path', () => {
  it('matches for a single opaque sprite', async () => {
    await expectParity((app) => {
      app.world.spawn(new Sprite({ color: vec4.create(1, 1, 1, 1), customSize: vec2.create(8, 8) }));
    });
  });

  it('matches same-image sprites ordered back-to-front', async () => {
    await expectParity((app, images) => {
      const a = images.add(Image.solid(vec4.create(1, 1, 1, 1), undefined, 'A'));
      const reds = [0.2, 0.4, 0.6, 0.8, 1.0];
      for (let i = 0; i < 5; i++) {
        app.world.spawn(
          new Sprite({ image: a, color: vec4.create(reds[i]!, 0, 0, 1), customSize: vec2.create(8, 8) }),
          new Transform(vec3.create(0, 0, i)),
        );
      }
    });
  });

  it('matches two images interleaved by Z (run-breaking)', async () => {
    await expectParity((app, images) => {
      const a = images.add(Image.solid(vec4.create(1, 0, 0, 1), undefined, 'A'));
      const b = images.add(Image.solid(vec4.create(0, 1, 0, 1), undefined, 'B'));
      app.world.spawn(new Sprite({ image: a, customSize: vec2.create(8, 8) }), new Transform(vec3.create(0, 0, 10)));
      app.world.spawn(new Sprite({ image: b, customSize: vec2.create(8, 8) }), new Transform(vec3.create(0, 0, 5)));
      app.world.spawn(new Sprite({ image: a, customSize: vec2.create(8, 8) }), new Transform(vec3.create(0, 0, 0)));
    });
  });

  it('matches a mixed opaque + transparent scene', async () => {
    await expectParity((app, images) => {
      const a = images.add(Image.solid(vec4.create(1, 1, 1, 1), undefined, 'A'));
      for (let i = 0; i < 4; i++) {
        const alpha = i % 2 === 0 ? 1 : 0.5;
        app.world.spawn(
          new Sprite({ image: a, color: vec4.create(1, 1, 1, alpha), customSize: vec2.create(8, 8) }),
          new Transform(vec3.create(i, 0, i)),
        );
      }
    });
  });

  it('matches sprites at the same Z across two images (same-Z regression)', async () => {
    await expectParity((app, images) => {
      const a = images.add(Image.solid(vec4.create(1, 0, 0, 1), undefined, 'A'));
      const b = images.add(Image.solid(vec4.create(0, 1, 0, 1), undefined, 'B'));
      for (let i = 0; i < 3; i++) app.world.spawn(new Sprite({ image: a, customSize: vec2.create(8, 8) }));
      for (let i = 0; i < 3; i++) app.world.spawn(new Sprite({ image: b, customSize: vec2.create(8, 8) }));
    });
  });

  it('produces no batches for an empty scene', async () => {
    const retained = retainedStateOf(await buildApp(true, () => {}));
    expect(retained.count).toBe(0);
    expect(retained.batches).toEqual([]);
  });
});

type SpawnMulti = (app: App, images: Images) => Entity[];
type Mutate = (app: App, entities: Entity[]) => void;

const buildAppTwoFrames = async (retained: boolean, spawn: SpawnMulti, mutate: Mutate): Promise<App> => {
  const { renderer } = makeCapturingRenderer();
  const app = new App({ renderer, canvas: makeStubCanvas() });
  app.addPlugin(new SpritePlugin({ retained }));
  const images = app.getResource(Images)!;
  const entities = spawn(app, images);
  app.world.spawn(...Camera2d());
  await app.run(); // frame 1
  app.stop();
  mutate(app, entities);
  app.advanceFrame(32); // frame 2 — change-gated prepare must converge on full-rebuild state
  return app;
};

const expectParityTwoFrames = async (spawn: SpawnMulti, mutate: Mutate): Promise<void> => {
  const legacy = legacyState(await buildAppTwoFrames(false, spawn, mutate));
  const retained = retainedStateOf(await buildAppTwoFrames(true, spawn, mutate));
  expect(retained.count).toBe(legacy.count);
  expect(retained.batches).toEqual(legacy.batches);
  expect(retained.words).toEqual(legacy.words);
};

describe('prepareSpritesRetained — change-gated updates converge on the full rebuild', () => {
  const spawnFour: SpawnMulti = (app, images) => {
    const a = images.add(Image.solid(vec4.create(1, 1, 1, 1), undefined, 'A'));
    const ids: Entity[] = [];
    for (let i = 0; i < 4; i++) {
      ids.push(
        app.world.spawn(
          new Sprite({ image: a, color: vec4.create(0.5, 0.5, 0.5, 1), customSize: vec2.create(8, 8) }),
          new Transform(vec3.create(0, 0, i)),
        ),
      );
    }
    return ids;
  };

  it('matches after a recolor and a Z move (re-sort)', async () => {
    await expectParityTwoFrames(spawnFour, (app, e) => {
      const sprite = app.world.getComponent(e[0]!, Sprite)!;
      sprite.color[0] = 0.123;
      app.world.markChanged(e[0]!, Sprite);
      const transform = app.world.getComponent(e[2]!, Transform)!;
      transform.translation[2] = 99; // jumps to back-most → forces re-sort
      app.world.markChanged(e[2]!, Transform);
    });
  });

  it('matches after an alpha flip (opaque → transparent bucket)', async () => {
    await expectParityTwoFrames(spawnFour, (app, e) => {
      const sprite = app.world.getComponent(e[1]!, Sprite)!;
      sprite.color[3] = 0.4;
      app.world.markChanged(e[1]!, Sprite);
    });
  });

  it('matches after a despawn and a spawn', async () => {
    await expectParityTwoFrames(spawnFour, (app, e) => {
      app.world.despawn(e[1]!);
      app.world.spawn(
        new Sprite({ color: vec4.create(1, 1, 1, 1), customSize: vec2.create(8, 8) }),
        new Transform(vec3.create(0, 0, 7)),
      );
    });
  });

  it('matches when nothing changes (steady state)', async () => {
    await expectParityTwoFrames(spawnFour, () => {});
  });
});

describe('prepareSpritesRetained — incremental uploads', () => {
  /** A rendering renderer that records every writeBuffer call's target + byte length. */
  const recordingRenderer = (): { renderer: typeof base; writes: Array<{ buffer: unknown; bytes: number }> } => {
    const base = makeRenderingRenderer();
    const writes: Array<{ buffer: unknown; bytes: number }> = [];
    const renderer = {
      ...base,
      writeBuffer: (buffer: unknown, _offset: number, data: BufferSource) => {
        writes.push({ buffer, bytes: (data as ArrayBufferView).byteLength });
      },
    };
    return { renderer, writes };
  };

  it('uploads nothing in a steady-state frame and only the changed sprite after a tint edit', async () => {
    const { renderer, writes } = recordingRenderer();
    const app = new App({ renderer: renderer as never, canvas: makeStubCanvas() });
    app.addPlugin(new SpritePlugin({ retained: true }));
    const images = app.getResource(Images)!;
    const a = images.add(Image.solid(vec4.create(1, 1, 1, 1), undefined, 'A'));
    const ids: Entity[] = [];
    for (let i = 0; i < 20; i++) {
      ids.push(
        app.world.spawn(
          new Sprite({ image: a, color: vec4.create(1, 1, 1, 1), customSize: vec2.create(8, 8) }),
          new Transform(vec3.create(0, 0, i)),
        ),
      );
    }
    app.world.spawn(...Camera2d());

    await app.run(); // frame 1: full seed
    app.stop();
    const ordered = app.getResource(RetainedSpriteBuffer)!.index.ordered.buffer;
    const toOrdered = (): number =>
      writes.filter((w) => w.buffer === ordered).reduce((s, w) => s + w.bytes, 0);

    // Frame 2: nothing changed → no upload to the instance buffer.
    writes.length = 0;
    app.advanceFrame(32);
    expect(toOrdered()).toBe(0);

    // Frame 3: one sprite's tint changes (same Z/image/bucket → no re-sort) →
    // exactly one instance re-uploaded, not all 20.
    writes.length = 0;
    const sprite = app.world.getComponent(ids[5]!, Sprite)!;
    sprite.color[0] = 0.25;
    app.world.markChanged(ids[5]!, Sprite);
    app.advanceFrame(48);
    expect(toOrdered()).toBe(SPRITE_INSTANCE_BYTE_SIZE);
  });
});
