import { describe, expect, it } from 'bun:test';

import { App, Camera2d, Text2d } from '../index';
import { makeCapturingRenderer, makeStubCanvas } from '../test-utils';

import { generateDefaultFontAtlas, installDefaultFont } from './default-font';
import { layoutText } from './text-layout';
import { TextInstanceBuffer } from './text-instance-buffer';
import { TextPlugin } from './text-plugin';

describe('default font', () => {
  it('generates a linear SDF atlas with the expected glyph coverage', () => {
    const { image, data } = generateDefaultFontAtlas();
    expect(image.format).toBe('rgba8unorm');
    expect(image.colorSpace).toBe('linear'); // distance field, never gamma-decoded
    expect(image.width).toBeGreaterThan(0);
    expect(image.height).toBeGreaterThan(0);

    // Uppercase, digits, and punctuation are drawn glyphs.
    expect(data.glyph(0x41)?.plane).toBeDefined(); // 'A'
    expect(data.glyph(0x30)?.plane).toBeDefined(); // '0'
    expect(data.glyph(0x21)?.plane).toBeDefined(); // '!'
    // Lowercase aliases the uppercase shape.
    expect(data.glyph(0x61)?.plane).toBeDefined(); // 'a'
    expect(data.glyph(0x61)?.advance).toBe(data.glyph(0x41)?.advance);
    // Space is advance-only.
    expect(data.glyph(0x20)?.advance).toBeGreaterThan(0);
    expect(data.glyph(0x20)?.plane).toBeUndefined();
  });

  it('lays out a mixed-case string through the generated metrics', () => {
    const { data } = generateDefaultFontAtlas();
    const layout = layoutText(data, 'Hi 42', { fontSize: 32 });
    // H, i, 4, 2 are drawn; the space is not.
    expect(layout.glyphs).toHaveLength(4);
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.lineCount).toBe(1);
  });
});

describe('installDefaultFont (integration)', () => {
  it('draws Text2d using the built-in font, one instance per visible glyph', async () => {
    const { renderer, log } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.addPlugin(new TextPlugin());

    const font = installDefaultFont(app);
    app.world.spawn(new Text2d({ text: 'HELLO', font, fontSize: 48 }));
    app.world.spawn(...Camera2d());

    await app.run();

    const transparent = log.passes.find((p) => p.label?.endsWith('.transparent2d'));
    expect(transparent).toBeDefined();
    const draws = transparent!.drawCalls.filter((c) => c.kind === 'drawIndexed');
    expect(draws).toHaveLength(1);
    expect(draws[0]!.drawIndexed!.instanceCount).toBe(5);
    expect(app.getResource(TextInstanceBuffer)!.count).toBe(5);
  });
});
