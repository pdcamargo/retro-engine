import { describe, expect, it } from 'bun:test';

import { UiNode } from './ui-node';

describe('UiNode', () => {
  it('fills style defaults from a partial init (constructor)', () => {
    const node = new UiNode({ width: 360 });
    expect(node.style.width).toBe(360);
    expect(node.style.display).toBe('flex');
    expect(node.style.minWidth).toBe(0);
    expect(node.style.maxWidth).toBeUndefined();
  });

  it('normalizes a partial style through makeStyle on assignment', () => {
    // Reproduces the reflection/scene-decode path, which sets a partial style
    // object with only the authored fields — the setter must fill the rest so the
    // layout engine never sees an undefined minWidth (which clamps to NaN).
    const node = new UiNode();
    (node as { style: unknown }).style = { width: 380, height: 200 };
    expect(node.style.width).toBe(380);
    expect(node.style.height).toBe(200);
    expect(node.style.display).toBe('flex');
    expect(node.style.minWidth).toBe(0);
    expect(node.style.flexShrink).toBe(1);
    expect(node.style.padding).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
  });
});
