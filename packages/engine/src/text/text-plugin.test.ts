import { describe, expect, it } from 'bun:test';

import { vec3, vec4 } from '@retro-engine/math';

import { App, Camera2d, Image, Images, Transform } from '../index';
import { makeCapturingRenderer, makeStubCanvas } from '../test-utils';

import { Font } from './font-asset';
import { Fonts } from './fonts';
import { type MsdfFontJson, parseMsdfFont } from './msdf-parser';
import { TextInstanceBuffer } from './text-instance-buffer';
import { Text2d } from './text2d';
import { TextPlugin } from './text-plugin';

const FONT_JSON: MsdfFontJson = {
  atlas: { type: 'msdf', distanceRange: 4, size: 32, width: 64, height: 64, yOrigin: 'bottom' },
  metrics: { emSize: 1, lineHeight: 1.25, ascender: 0.8, descender: -0.2 },
  glyphs: [
    { unicode: 32, advance: 0.25 },
    {
      unicode: 65, // 'A'
      advance: 0.5,
      planeBounds: { left: 0, bottom: 0, right: 0.5, top: 0.7 },
      atlasBounds: { left: 0, bottom: 0, right: 32, top: 45 },
    },
    {
      unicode: 66, // 'B'
      advance: 0.5,
      planeBounds: { left: 0, bottom: 0, right: 0.5, top: 0.7 },
      atlasBounds: { left: 32, bottom: 0, right: 64, top: 45 },
    },
  ],
};

/** Register a synthetic font (in-memory atlas image) in the Fonts store. */
const seedFont = (app: App): ReturnType<Fonts['add']> => {
  const images = app.getResource(Images)!;
  const atlas = images.add(Image.solid(vec4.create(1, 1, 1, 1), { colorSpace: 'linear', label: 'atlas' }));
  const font = new Font(parseMsdfFont(FONT_JSON), atlas);
  return app.getResource(Fonts)!.add(font);
};

describe('TextPlugin (integration)', () => {
  it('emits one transparent instanced draw per text entity, one instance per glyph', async () => {
    const { renderer, log } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.addPlugin(new TextPlugin());

    const font = seedFont(app);
    app.world.spawn(new Text2d({ text: 'AB', font, fontSize: 32 }));
    app.world.spawn(...Camera2d());

    await app.run();

    const transparent = log.passes.find((p) => p.label?.endsWith('.transparent2d'));
    expect(transparent).toBeDefined();
    const draws = transparent!.drawCalls.filter((c) => c.kind === 'drawIndexed');
    // One batch (one entity), 2 visible glyphs → instanceCount 2.
    expect(draws).toHaveLength(1);
    expect(draws[0]!.drawIndexed!.instanceCount).toBe(2);

    expect(app.getResource(TextInstanceBuffer)!.count).toBe(2);
  });

  it('emits one batch per text entity (independent depth sort)', async () => {
    const { renderer, log } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.addPlugin(new TextPlugin());

    const font = seedFont(app);
    app.world.spawn(new Text2d({ text: 'A', font, fontSize: 32 }), new Transform(vec3.create(0, 0, 1)));
    app.world.spawn(new Text2d({ text: 'B', font, fontSize: 32 }), new Transform(vec3.create(0, 0, 0)));
    app.world.spawn(...Camera2d());

    await app.run();

    const transparent = log.passes.find((p) => p.label?.endsWith('.transparent2d'));
    expect(transparent).toBeDefined();
    const draws = transparent!.drawCalls.filter((c) => c.kind === 'drawIndexed');
    expect(draws).toHaveLength(2);
    for (const d of draws) expect(d.drawIndexed!.instanceCount).toBe(1);
  });

  it('skips text with no font and whitespace-only strings (no draws, no glyphs)', async () => {
    const { renderer, log } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.addPlugin(new TextPlugin());

    const font = seedFont(app);
    app.world.spawn(new Text2d({ text: 'no font here', fontSize: 32 })); // font undefined
    app.world.spawn(new Text2d({ text: '   ', font, fontSize: 32 })); // whitespace → no glyph quads
    app.world.spawn(...Camera2d());

    await app.run();

    const transparent = log.passes.find((p) => p.label?.endsWith('.transparent2d'));
    // No visible glyphs anywhere → transparent phase has no items, pass skipped.
    expect(transparent).toBeUndefined();
    expect(app.getResource(TextInstanceBuffer)!.count).toBe(0);
  });

  it('binds the font atlas at @group(1) before the draw', async () => {
    const { renderer, log } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.addPlugin(new TextPlugin());

    const font = seedFont(app);
    app.world.spawn(new Text2d({ text: 'A', font, fontSize: 32 }));
    app.world.spawn(...Camera2d());

    await app.run();

    const transparent = log.passes.find((p) => p.label?.endsWith('.transparent2d'))!;
    const group1 = transparent.drawCalls.filter(
      (c) => c.kind === 'setBindGroup' && c.bindGroup?.index === 1,
    );
    expect(group1).toHaveLength(1);
  });
});
