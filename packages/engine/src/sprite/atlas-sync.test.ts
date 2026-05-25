import { describe, expect, it } from 'bun:test';

import { vec2, vec4 } from '@retro-engine/math';

import {
  App,
  Camera2d,
  Image,
  Images,
  Sprite,
  SPRITE_INSTANCE_FLOAT_COUNT,
  SpriteInstanceBuffer,
  SpritePlugin,
  TextureAtlas,
  TextureAtlasLayout,
  TextureAtlasLayouts,
} from '../index';
import { makeCapturingRenderer, makeStubCanvas } from '../test-utils';

/** Read the four UV slots ([6..9]) for the i-th instance out of the scratch buffer. */
const readUv = (
  buffer: SpriteInstanceBuffer,
  i: number,
): readonly [number, number, number, number] => {
  const base = i * SPRITE_INSTANCE_FLOAT_COUNT;
  return [
    buffer.scratchF32[base + 6] as number,
    buffer.scratchF32[base + 7] as number,
    buffer.scratchF32[base + 8] as number,
    buffer.scratchF32[base + 9] as number,
  ];
};

const uvKey = (uv: readonly [number, number, number, number]): string => uv.join(',');

describe('atlasSyncSystem (integration)', () => {
  it('writes Sprite.rect from layout.textures[index] before sprite-prepare packs the batch', async () => {
    const { renderer } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.addPlugin(new SpritePlugin());

    const images = app.getResource(Images)!;
    const layouts = app.getResource(TextureAtlasLayouts)!;
    const sheet = images.add(
      Image.checker(4, vec4.create(1, 1, 1, 1), vec4.create(0, 0, 0, 1), undefined, 'sheet'),
    );
    // 4 columns × 1 row of 16-pixel tiles → 4 normalised rects each 0.25 wide.
    const layout = layouts.add(
      TextureAtlasLayout.fromGrid({ tileSize: vec2.create(16, 16), columns: 4, rows: 1 }),
    );

    // Three sprites sharing one image + one layout; distinct indices.
    for (const index of [0, 2, 3]) {
      app.world.spawn(
        new Sprite({ image: sheet, color: vec4.create(1, 1, 1, 1), customSize: vec2.create(8, 8) }),
        new TextureAtlas(layout, index),
      );
    }
    app.world.spawn(...Camera2d());

    await app.run();

    const instanceBuffer = app.getResource(SpriteInstanceBuffer)!;
    expect(instanceBuffer.count).toBe(3);

    const observed = new Set([
      uvKey(readUv(instanceBuffer, 0)),
      uvKey(readUv(instanceBuffer, 1)),
      uvKey(readUv(instanceBuffer, 2)),
    ]);
    const expected = new Set([
      uvKey([0, 0, 0.25, 1]),
      uvKey([0.5, 0, 0.75, 1]),
      uvKey([0.75, 0, 1, 1]),
    ]);
    expect(observed).toEqual(expected);
  });

  it('still emits exactly one instanced draw across multiple atlassed sprites sharing one image', async () => {
    const { renderer, log } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.addPlugin(new SpritePlugin());

    const images = app.getResource(Images)!;
    const layouts = app.getResource(TextureAtlasLayouts)!;
    const sheet = images.add(
      Image.checker(4, vec4.create(1, 1, 1, 1), vec4.create(0, 0, 0, 1), undefined, 'sheet'),
    );
    const layout = layouts.add(
      TextureAtlasLayout.fromGrid({ tileSize: vec2.create(16, 16), columns: 4, rows: 1 }),
    );
    for (const index of [0, 1, 2, 3]) {
      app.world.spawn(
        new Sprite({ image: sheet, color: vec4.create(1, 1, 1, 1), customSize: vec2.create(8, 8) }),
        new TextureAtlas(layout, index),
      );
    }
    app.world.spawn(...Camera2d());

    await app.run();

    const opaque = log.passes.find((p) => p.label?.endsWith('.opaque2d'));
    expect(opaque).toBeDefined();
    const drawIndexed = opaque!.drawCalls.filter((c) => c.kind === 'drawIndexed');
    expect(drawIndexed).toHaveLength(1);
    expect(drawIndexed[0]!.drawIndexed!.instanceCount).toBe(4);
  });

  it('re-syncs sprite.rect on the frame after atlas.index is mutated', async () => {
    const { renderer } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.addPlugin(new SpritePlugin());

    const images = app.getResource(Images)!;
    const layouts = app.getResource(TextureAtlasLayouts)!;
    const sheet = images.add(
      Image.checker(4, vec4.create(1, 1, 1, 1), vec4.create(0, 0, 0, 1), undefined, 'sheet'),
    );
    const layout = layouts.add(
      TextureAtlasLayout.fromGrid({ tileSize: vec2.create(16, 16), columns: 4, rows: 1 }),
    );

    const entities = [0, 2, 3].map((index) =>
      app.world.spawn(
        new Sprite({ image: sheet, color: vec4.create(1, 1, 1, 1), customSize: vec2.create(8, 8) }),
        new TextureAtlas(layout, index),
      ),
    );
    app.world.spawn(...Camera2d());

    await app.run();

    // Mutate the first entity's atlas → index 1. With markChanged, the
    // `Changed<TextureAtlas>` filter on atlas-sync picks it up next frame.
    const target = entities[0]!;
    const atlas = app.world.getComponent(target, TextureAtlas)!;
    atlas.index = 1;
    app.world.markChanged(target, TextureAtlas);

    app.advanceFrame(16);

    const instanceBuffer = app.getResource(SpriteInstanceBuffer)!;
    expect(instanceBuffer.count).toBe(3);
    const observed = new Set([
      uvKey(readUv(instanceBuffer, 0)),
      uvKey(readUv(instanceBuffer, 1)),
      uvKey(readUv(instanceBuffer, 2)),
    ]);
    // index 0 → now index 1 (uv [0.25, 0, 0.5, 1]); other two unchanged.
    const expected = new Set([
      uvKey([0.25, 0, 0.5, 1]),
      uvKey([0.5, 0, 0.75, 1]),
      uvKey([0.75, 0, 1, 1]),
    ]);
    expect(observed).toEqual(expected);
  });

  it('silently skips entities whose atlas.index is out of bounds — sprite.rect untouched', async () => {
    const { renderer } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.addPlugin(new SpritePlugin());

    const layouts = app.getResource(TextureAtlasLayouts)!;
    const layout = layouts.add(
      TextureAtlasLayout.fromGrid({ tileSize: vec2.create(16, 16), columns: 2, rows: 1 }),
    );

    const e = app.world.spawn(
      new Sprite({ color: vec4.create(1, 1, 1, 1), customSize: vec2.create(8, 8) }),
      new TextureAtlas(layout, 99), // out of bounds
    );
    app.world.spawn(...Camera2d());

    await app.run();

    // sprite.rect stays undefined → packSpriteInstance falls back to the
    // default full-image UV.
    const sprite = app.world.getComponent(e, Sprite)!;
    expect(sprite.rect).toBeUndefined();
  });
});
