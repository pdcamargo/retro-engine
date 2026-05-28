import { describe, expect, it } from 'bun:test';

import { vec2, vec4 } from '@retro-engine/math';

import {
  Aabb,
  App,
  Image,
  Images,
  NoFrustumCulling,
  Sprite,
  SpritePlugin,
  TextureAtlas,
  TextureAtlasLayout,
  TextureAtlasLayouts,
} from '../index';
import { makeCapturingRenderer, makeRenderingRenderer, makeStubCanvas } from '../test-utils';

describe('calculateSpriteBoundsSystem (integration)', () => {
  it('writes Aabb from sprite.customSize when set, anchor-centered by default', async () => {
    const { renderer } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.addPlugin(new SpritePlugin());

    const e = app.world.spawn(
      new Sprite({ color: vec4.create(1, 1, 1, 1), customSize: vec2.create(32, 24) }),
    );
    await app.run();

    const aabb = app.world.getComponent(e, Aabb);
    expect(aabb).toBeDefined();
    // anchor 'center' (0.5, 0.5) → AABB centred on origin.
    expect(aabb!.center[0]).toBe(0);
    expect(aabb!.center[1]).toBe(0);
    expect(aabb!.center[2]).toBe(0);
    expect(aabb!.halfExtents[0]).toBe(16);
    expect(aabb!.halfExtents[1]).toBe(12);
    expect(aabb!.halfExtents[2]).toBe(0);
  });

  it('derives Aabb from the source image when customSize is omitted', async () => {
    const { renderer } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.addPlugin(new SpritePlugin());

    const images = app.getResource(Images)!;
    const sheet = images.add(
      Image.checker(8, vec4.create(1, 1, 1, 1), vec4.create(0, 0, 0, 1), { label: 'sheet' }),
    );
    const e = app.world.spawn(new Sprite({ image: sheet }));
    await app.run();

    const aabb = app.world.getComponent(e, Aabb)!;
    // 8×8 image, center anchor → half-extents (4, 4, 0).
    expect(aabb.halfExtents[0]).toBe(4);
    expect(aabb.halfExtents[1]).toBe(4);
  });

  it('derives Aabb from the atlas layout when customSize is omitted', async () => {
    const { renderer } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.addPlugin(new SpritePlugin());

    const images = app.getResource(Images)!;
    const layouts = app.getResource(TextureAtlasLayouts)!;
    const sheet = images.add(
      Image.checker(4, vec4.create(1, 1, 1, 1), vec4.create(0, 0, 0, 1), { label: 'sheet' }),
    );
    // Layout's source is 64×16, but each tile is 16×16 — bounds must use the
    // per-tile pixel size (layout.size × uvSpan), not the layout's full size.
    const layout = layouts.add(
      TextureAtlasLayout.fromGrid({ tileSize: vec2.create(16, 16), columns: 4, rows: 1 }),
    );
    const e = app.world.spawn(new Sprite({ image: sheet }), new TextureAtlas(layout, 1));
    await app.run();

    const aabb = app.world.getComponent(e, Aabb)!;
    // Tile is 16×16 → half-extents (8, 8, 0). NOT 32 × 8 (the layout's full size).
    expect(aabb.halfExtents[0]).toBe(8);
    expect(aabb.halfExtents[1]).toBe(8);
  });

  it('honors a non-center anchor: bottom-left places the AABB centre in the positive quadrant', async () => {
    const { renderer } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.addPlugin(new SpritePlugin());

    const e = app.world.spawn(
      new Sprite({
        color: vec4.create(1, 1, 1, 1),
        customSize: vec2.create(20, 10),
        anchor: 'bottomLeft',
      }),
    );
    await app.run();

    const aabb = app.world.getComponent(e, Aabb)!;
    // anchor (0, 0) → centre at (w/2, h/2).
    expect(aabb.center[0]).toBe(10);
    expect(aabb.center[1]).toBe(5);
    expect(aabb.halfExtents[0]).toBe(10);
    expect(aabb.halfExtents[1]).toBe(5);
  });

  it('skips entities carrying NoFrustumCulling — no Aabb inserted', async () => {
    const { renderer } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.addPlugin(new SpritePlugin());

    const e = app.world.spawn(
      new Sprite({ color: vec4.create(1, 1, 1, 1), customSize: vec2.create(8, 8) }),
      new NoFrustumCulling(),
    );
    await app.run();

    expect(app.world.getComponent(e, Aabb)).toBeUndefined();
  });

  it('is change-gated: skips an unchanged sprite, refreshes on markChanged(Sprite)', () => {
    const app = new App({ renderer: makeRenderingRenderer(), canvas: makeStubCanvas() });
    app.addPlugin(new SpritePlugin());

    const sprite = new Sprite({ color: vec4.create(1, 1, 1, 1), customSize: vec2.create(32, 24) });
    const e = app.world.spawn(sprite);

    // Frame the Sprite is added: bounds written.
    app.advanceFrame();
    expect(app.world.getComponent(e, Aabb)!.halfExtents[0]).toBe(16);

    // Mutate the footprint in place without signalling — bounds must NOT refresh.
    sprite.customSize = vec2.create(100, 100);
    app.advanceFrame();
    expect(app.world.getComponent(e, Aabb)!.halfExtents[0]).toBe(16);

    // markChanged re-runs the writer for that entity.
    app.world.markChanged(e, Sprite);
    app.advanceFrame();
    expect(app.world.getComponent(e, Aabb)!.halfExtents[0]).toBe(50);
  });
});
