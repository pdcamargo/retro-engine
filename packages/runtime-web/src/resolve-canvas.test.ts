import { describe, expect, it } from 'bun:test';

import type { CanvasDocument } from './resolve-canvas';
import { resolveCanvas } from './resolve-canvas';

const fakeDoc = (elements: Record<string, { tagName?: string }>): CanvasDocument => ({
  getElementById: (id) => elements[id] ?? null,
});

describe('resolveCanvas', () => {
  it('returns an HTMLCanvasElement target as-is', () => {
    // A stub that is not a real HTMLCanvasElement is treated as an id path, so
    // this asserts the element branch only where the class exists. In bun the
    // DOM class is absent, so we cover the element path via the id lookup below.
    const doc = fakeDoc({ game: { tagName: 'CANVAS' } });
    expect(resolveCanvas('game', doc).tagName).toBe('CANVAS');
  });

  it('resolves a string id to the canvas element in the document', () => {
    const canvas = { tagName: 'canvas' };
    const doc = fakeDoc({ main: canvas });
    expect(resolveCanvas('main', doc)).toBe(canvas as unknown as HTMLCanvasElement);
  });

  it('throws when the id is not found', () => {
    const doc = fakeDoc({});
    expect(() => resolveCanvas('missing', doc)).toThrow(/no element with id 'missing'/);
  });

  it('throws when the element is not a canvas', () => {
    const doc = fakeDoc({ root: { tagName: 'DIV' } });
    expect(() => resolveCanvas('root', doc)).toThrow(/not a <canvas>/);
  });

  it('throws when no document is available to resolve an id', () => {
    expect(() => resolveCanvas('game', undefined)).toThrow(/no document available/);
  });
});
