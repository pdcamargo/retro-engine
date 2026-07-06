import { describe, expect, it } from 'bun:test';

import { quat, vec3, vec4 } from '@retro-engine/math';

import { App, Camera3d, Image, Images, Transform } from '../index';
import { makeCapturingRenderer, makeStubCanvas } from '../test-utils';

import { Font } from './font-asset';
import { Fonts } from './fonts';
import { type MsdfFontJson, parseMsdfFont } from './msdf-parser';
import { Text } from './text3d';
import { Text3dInstanceBuffer } from './text-instance-buffer-3d';
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

const seedFont = (app: App): ReturnType<Fonts['add']> => {
  const images = app.getResource(Images)!;
  const atlas = images.add(Image.solid(vec4.create(1, 1, 1, 1), { colorSpace: 'linear', label: 'atlas' }));
  const font = new Font(parseMsdfFont(FONT_JSON), atlas);
  return app.getResource(Fonts)!.add(font);
};

// Places the text a few units in front of a default (identity, −Z-facing) camera.
const inFront = () => new Transform(vec3.create(0, 0, -3), quat.identity(), vec3.create(0.05, 0.05, 0.05));

describe('TextPlugin — world-space 3D text (integration)', () => {
  it('emits one transparent3d instanced draw per Text entity, one instance per glyph', async () => {
    const { renderer, log } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.addPlugin(new TextPlugin());

    const font = seedFont(app);
    app.world.spawn(new Text({ text: 'AB', font, fontSize: 32 }), inFront());
    app.world.spawn(...Camera3d());

    await app.run();

    const transparent = log.passes.find((p) => p.label?.endsWith('.transparent3d'));
    expect(transparent).toBeDefined();
    const draws = transparent!.drawCalls.filter((c) => c.kind === 'drawIndexed');
    // One batch (one entity), 2 visible glyphs → instanceCount 2.
    expect(draws).toHaveLength(1);
    expect(draws[0]!.drawIndexed!.instanceCount).toBe(2);
    expect(app.getResource(Text3dInstanceBuffer)!.count).toBe(2);
  });

  it('binds the font atlas at @group(1) before the 3D draw', async () => {
    const { renderer, log } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.addPlugin(new TextPlugin());

    const font = seedFont(app);
    app.world.spawn(new Text({ text: 'A', font, fontSize: 32 }), inFront());
    app.world.spawn(...Camera3d());

    await app.run();

    const transparent = log.passes.find((p) => p.label?.endsWith('.transparent3d'))!;
    const group1 = transparent.drawCalls.filter((c) => c.kind === 'setBindGroup' && c.bindGroup?.index === 1);
    expect(group1).toHaveLength(1);
  });

  it('skips Text with no font (no 3D draws, no glyphs)', async () => {
    const { renderer, log } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.addPlugin(new TextPlugin());

    seedFont(app);
    app.world.spawn(new Text({ text: 'no font', fontSize: 32 }), inFront()); // font undefined
    app.world.spawn(...Camera3d());

    await app.run();

    const transparent = log.passes.find((p) => p.label?.endsWith('.transparent3d'));
    expect(transparent).toBeUndefined();
    expect(app.getResource(Text3dInstanceBuffer)!.count).toBe(0);
  });
});
