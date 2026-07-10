import { describe, expect, it } from 'bun:test';

import type { Font, Fonts, Handle, TextLayoutOptions } from '@retro-engine/engine';

import { makeTextMeasure } from './text-measure';
import { UiText } from './ui-text';

const fontHandle = {} as Handle<Font>;

/** A `Font` stub whose `measure` records the options it saw and returns a fixed size. */
const fakeFont = (capture?: (options: TextLayoutOptions) => void): Font =>
  ({
    measure: (text: string, options: TextLayoutOptions) => {
      capture?.(options);
      return { width: text.length * options.fontSize, height: options.lineHeight ?? options.fontSize, lineCount: 1 };
    },
  }) as unknown as Font;

/** A `Fonts` store stub whose `get` always resolves to `font` (or `undefined`). */
const fakeFonts = (font: Font | undefined): Fonts => ({ get: () => font }) as unknown as Fonts;

describe('makeTextMeasure', () => {
  it('returns undefined for empty text', () => {
    expect(makeTextMeasure(new UiText({ text: '', font: fontHandle }), fakeFonts(fakeFont()))).toBeUndefined();
  });

  it('returns undefined when no font handle is set and no default font is available', () => {
    expect(makeTextMeasure(new UiText({ text: 'hi' }), fakeFonts(fakeFont()))).toBeUndefined();
  });

  it('falls back to the default font when the node has no explicit font', () => {
    const measure = makeTextMeasure(new UiText({ text: 'hi', fontSize: 10 }), fakeFonts(fakeFont()), fontHandle);
    expect(measure).toBeDefined();
    expect(measure!(Infinity, Infinity).width).toBe(20); // 2 chars × 10, measured via the default font
  });

  it('returns undefined when the font is not loaded yet', () => {
    expect(makeTextMeasure(new UiText({ text: 'hi', font: fontHandle }), fakeFonts(undefined))).toBeUndefined();
  });

  it('measures through the font, passing fontSize + letterSpacing and mapping the size back', () => {
    let seen: TextLayoutOptions | undefined;
    const measure = makeTextMeasure(
      new UiText({ text: 'hello', font: fontHandle, fontSize: 20, letterSpacing: 2 }),
      fakeFonts(fakeFont((o) => { seen = o; })),
    )!;
    const size = measure(Infinity, Infinity);

    expect(seen?.fontSize).toBe(20);
    expect(seen?.letterSpacing).toBe(2);
    expect(seen?.lineHeight).toBeUndefined();
    expect(seen && 'maxWidth' in seen).toBe(false); // unconstrained → no wrap width
    expect(size.width).toBe(100); // 5 chars × 20
    expect(size.height).toBe(20);
  });

  it('passes a finite available width as the wrap maxWidth, and lineHeight when set', () => {
    let seen: TextLayoutOptions | undefined;
    const measure = makeTextMeasure(
      new UiText({ text: 'hello world', font: fontHandle, fontSize: 16, lineHeight: 24 }),
      fakeFonts(fakeFont((o) => { seen = o; })),
    )!;
    const size = measure(80, Number.POSITIVE_INFINITY);

    expect(seen?.maxWidth).toBe(80);
    expect(seen?.lineHeight).toBe(24);
    expect(size.height).toBe(24);
  });
});
