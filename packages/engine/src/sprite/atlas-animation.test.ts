import { describe, expect, it } from 'bun:test';

import { vec2, vec4 } from '@retro-engine/math';

import {
  App,
  AtlasAnimation,
  Sprite,
  SpritePlugin,
  TextureAtlas,
  TextureAtlasLayout,
  TextureAtlasLayouts,
} from '../index';
import { makeHeadlessRenderer } from '../test-utils';

/** Build an App + SpritePlugin + a 4-column texture-atlas layout, ready for tests. */
const setupApp = () => {
  const app = new App({ renderer: makeHeadlessRenderer() });
  app.addPlugin(new SpritePlugin());
  const layouts = app.getResource(TextureAtlasLayouts)!;
  const layout = layouts.add(
    TextureAtlasLayout.fromGrid({ tileSize: vec2.create(16, 16), columns: 4, rows: 1 }),
  );
  return { app, layouts, layout };
};

describe('atlasAnimationSystem', () => {
  it("'loop': index marches firstIndex → … → lastIndex → firstIndex at the configured fps", () => {
    const { app, layout } = setupApp();

    const e = app.world.spawn(
      new TextureAtlas(layout, 0),
      new AtlasAnimation({ firstIndex: 0, lastIndex: 3, fps: 10, mode: 'loop' }),
    );

    // Frame 1 — delta=0, animator no-op (target equals current).
    app.advanceFrame(0);
    expect(app.world.getComponent(e, TextureAtlas)!.index).toBe(0);

    // Subsequent frames at 100ms intervals advance one frame per tick at fps=10.
    app.advanceFrame(100);
    expect(app.world.getComponent(e, TextureAtlas)!.index).toBe(1);
    app.advanceFrame(200);
    expect(app.world.getComponent(e, TextureAtlas)!.index).toBe(2);
    app.advanceFrame(300);
    expect(app.world.getComponent(e, TextureAtlas)!.index).toBe(3);
    // Wraps from lastIndex back to firstIndex.
    app.advanceFrame(400);
    expect(app.world.getComponent(e, TextureAtlas)!.index).toBe(0);
  });

  it("'once': clamps at lastIndex and self-pauses on completion", () => {
    const { app, layout } = setupApp();

    const e = app.world.spawn(
      new TextureAtlas(layout, 0),
      new AtlasAnimation({ firstIndex: 0, lastIndex: 3, fps: 10, mode: 'once' }),
    );

    app.advanceFrame(0);
    app.advanceFrame(100);
    expect(app.world.getComponent(e, TextureAtlas)!.index).toBe(1);
    app.advanceFrame(200);
    expect(app.world.getComponent(e, TextureAtlas)!.index).toBe(2);

    // Reaching lastIndex flips paused → true; index pins at lastIndex.
    app.advanceFrame(300);
    expect(app.world.getComponent(e, TextureAtlas)!.index).toBe(3);
    expect(app.world.getComponent(e, AtlasAnimation)!.paused).toBe(true);

    // Subsequent frames change nothing — paused short-circuits the iterator.
    const elapsedAtPause = app.world.getComponent(e, AtlasAnimation)!.elapsedSec;
    app.advanceFrame(400);
    app.advanceFrame(500);
    expect(app.world.getComponent(e, TextureAtlas)!.index).toBe(3);
    expect(app.world.getComponent(e, AtlasAnimation)!.elapsedSec).toBe(elapsedAtPause);
  });

  it("'pingPong': 4-frame range yields 0,1,2,3,2,1,0,1,…", () => {
    const { app, layout } = setupApp();

    const e = app.world.spawn(
      new TextureAtlas(layout, 0),
      new AtlasAnimation({ firstIndex: 0, lastIndex: 3, fps: 10, mode: 'pingPong' }),
    );

    const observed: number[] = [];
    app.advanceFrame(0);
    observed.push(app.world.getComponent(e, TextureAtlas)!.index);
    for (let t = 100; t <= 700; t += 100) {
      app.advanceFrame(t);
      observed.push(app.world.getComponent(e, TextureAtlas)!.index);
    }
    expect(observed).toEqual([0, 1, 2, 3, 2, 1, 0, 1]);
  });

  it('paused: true → index does not change and elapsedSec stays at 0', () => {
    const { app, layout } = setupApp();

    const e = app.world.spawn(
      new TextureAtlas(layout, 2),
      new AtlasAnimation({ firstIndex: 0, lastIndex: 3, fps: 10, paused: true }),
    );

    for (let t = 0; t <= 1000; t += 100) {
      app.advanceFrame(t);
    }
    expect(app.world.getComponent(e, TextureAtlas)!.index).toBe(2);
    expect(app.world.getComponent(e, AtlasAnimation)!.elapsedSec).toBe(0);
  });

  it('degenerate single-frame range (firstIndex === lastIndex) pins to firstIndex without crashing', () => {
    const { app, layout } = setupApp();

    const e = app.world.spawn(
      new TextureAtlas(layout, 0),
      new AtlasAnimation({ firstIndex: 2, lastIndex: 2, fps: 10, mode: 'loop' }),
    );

    app.advanceFrame(0);
    expect(app.world.getComponent(e, TextureAtlas)!.index).toBe(2);
    app.advanceFrame(100);
    app.advanceFrame(200);
    expect(app.world.getComponent(e, TextureAtlas)!.index).toBe(2);
  });

  it('integration: animator → atlas-sync writes sprite.rect = layout.textures[animator-current]', () => {
    const { app, layouts, layout } = setupApp();

    const e = app.world.spawn(
      new Sprite({ color: vec4.create(1, 1, 1, 1), customSize: vec2.create(8, 8) }),
      new TextureAtlas(layout, 0),
      new AtlasAnimation({ firstIndex: 0, lastIndex: 3, fps: 10, mode: 'loop' }),
    );

    // First frame: animator no-op, atlas-sync handles the freshly-spawned row
    // (Changed since 0) and writes sprite.rect = layout.textures[0].
    app.advanceFrame(0);
    const layoutAsset = layouts.get(layout)!;
    expect(app.world.getComponent(e, Sprite)!.rect).toBe(layoutAsset.textures[0]);

    // Second frame: animator advances to index 1, marks TextureAtlas changed,
    // atlas-sync runs in the same frame (before-ordering) and updates sprite.rect.
    app.advanceFrame(100);
    expect(app.world.getComponent(e, TextureAtlas)!.index).toBe(1);
    expect(app.world.getComponent(e, Sprite)!.rect).toBe(layoutAsset.textures[1]);
  });
});
