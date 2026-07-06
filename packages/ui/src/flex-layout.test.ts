import { describe, expect, it } from 'bun:test';

import { FlexLayoutEngine } from './flex-layout';
import type { LayoutNode } from './layout-engine';
import { type JustifyContent, makeStyle, type UiStyleInit } from './ui-style';

const engine = new FlexLayoutEngine();

const node = (
  style: UiStyleInit,
  children: LayoutNode[] = [],
  extra: Partial<LayoutNode> = {},
): LayoutNode => ({ style: makeStyle(style), children, ...extra });

const rects = (root: LayoutNode) => {
  const r = engine.compute(root, {
    width: root.style.width ?? 1000,
    height: root.style.height ?? 1000,
  });
  return r.children.map((c) => c.rect);
};

describe('FlexLayoutEngine — main axis', () => {
  it('packs fixed-size children from the start of a row', () => {
    const r = rects(node({ width: 300, height: 100 }, [node({ width: 50 }), node({ width: 50 }), node({ width: 50 })]));
    expect(r[0]).toEqual({ x: 0, y: 0, width: 50, height: 100 });
    expect(r[1]!.x).toBe(50);
    expect(r[2]!.x).toBe(100);
  });

  it('distributes positive free space by flex-grow', () => {
    const r = rects(node({ width: 300, height: 100 }, [node({ width: 50, flexGrow: 1 }), node({ width: 50, flexGrow: 1 })]));
    // free = 300 - 100 = 200 → +100 each → 150 wide.
    expect(r[0]!.width).toBe(150);
    expect(r[1]!.width).toBe(150);
    expect(r[1]!.x).toBe(150);
  });

  it('distributes negative free space by flex-shrink scaled by base size', () => {
    const r = rects(node({ width: 100, height: 100 }, [node({ width: 100 }), node({ width: 100 })]));
    // both shrink 1, scaled equally → 50 each.
    expect(r[0]!.width).toBe(50);
    expect(r[1]!.width).toBe(50);
  });

  it('respects min-width while shrinking (iterative freeze)', () => {
    const r = rects(node({ width: 100, height: 100 }, [node({ width: 100, minWidth: 60 }), node({ width: 100 })]));
    expect(r[0]!.width).toBe(60);
    expect(r[1]!.width).toBe(40);
  });
});

describe('FlexLayoutEngine — justify-content', () => {
  const two = () => node({ width: 300, height: 100, justifyContent: 'flex-start' }, [node({ width: 50 }), node({ width: 50 })]);
  const withJustify = (j: JustifyContent) => {
    const n = two();
    return rects({ ...n, style: makeStyle({ width: 300, height: 100, justifyContent: j }) });
  };

  it('center offsets by half the leftover', () => {
    const r = withJustify('center');
    expect(r[0]!.x).toBe(100); // (300-100)/2
    expect(r[1]!.x).toBe(150);
  });

  it('flex-end pushes items to the far edge', () => {
    const r = withJustify('flex-end');
    expect(r[0]!.x).toBe(200);
    expect(r[1]!.x).toBe(250);
  });

  it('space-between spreads the gap to the edges', () => {
    const r = withJustify('space-between');
    expect(r[0]!.x).toBe(0);
    expect(r[1]!.x).toBe(250); // 50 + 200 gap
  });

  it('space-evenly puts equal gaps everywhere', () => {
    const r = withJustify('space-evenly');
    // leftover 200 / 3 ≈ 66.67 before, between, after.
    expect(r[0]!.x).toBeCloseTo(200 / 3);
    expect(r[1]!.x).toBeCloseTo(200 / 3 + 50 + 200 / 3);
  });
});

describe('FlexLayoutEngine — cross axis', () => {
  it('stretches items to the cross size by default', () => {
    const r = rects(node({ width: 300, height: 100 }, [node({ width: 50 })]));
    expect(r[0]!.height).toBe(100);
  });

  it('centers a fixed cross-size item', () => {
    const r = rects(node({ width: 300, height: 100, alignItems: 'center' }, [node({ width: 50, height: 40 })]));
    expect(r[0]!.y).toBe(30);
    expect(r[0]!.height).toBe(40);
  });

  it('aligns to the cross end', () => {
    const r = rects(node({ width: 300, height: 100, alignItems: 'flex-end' }, [node({ width: 50, height: 40 })]));
    expect(r[0]!.y).toBe(60);
  });

  it('honors per-item align-self over the container default', () => {
    const r = rects(node({ width: 300, height: 100, alignItems: 'flex-start' }, [node({ width: 50, height: 40, alignSelf: 'flex-end' })]));
    expect(r[0]!.y).toBe(60);
  });
});

describe('FlexLayoutEngine — direction, gap, box model', () => {
  it('lays a column top-to-bottom', () => {
    const r = rects(node({ width: 100, height: 300, flexDirection: 'column' }, [node({ height: 50 }), node({ height: 50 })]));
    expect(r[0]).toEqual({ x: 0, y: 0, width: 100, height: 50 });
    expect(r[1]!.y).toBe(50);
  });

  it('inserts gap between items', () => {
    const r = rects(node({ width: 300, height: 100, gap: 10 }, [node({ width: 50 }), node({ width: 50 })]));
    expect(r[1]!.x).toBe(60);
  });

  it('offsets children by the container padding', () => {
    const root = node({ width: 200, height: 100, padding: 20 }, [node({ width: 50 })]);
    const result = engine.compute(root, { width: 200, height: 100 });
    expect(result.contentWidth).toBe(160);
    expect(result.children[0]!.rect.x).toBe(20);
    expect(result.children[0]!.rect.y).toBe(20);
    // stretched cross height = content height (100 - 40 padding) = 60.
    expect(result.children[0]!.rect.height).toBe(60);
  });

  it('accounts for item margins in flow', () => {
    const r = rects(node({ width: 300, height: 100 }, [node({ width: 50, margin: { left: 10 } }), node({ width: 50 })]));
    expect(r[0]!.x).toBe(10); // margin-left 10
    expect(r[1]!.x).toBe(60); // 10 margin + 50 width
  });

  it('reverses order for row-reverse (first child on the right)', () => {
    const r = rects(node({ width: 300, height: 100, flexDirection: 'row-reverse' }, [node({ width: 50 }), node({ width: 50 })]));
    expect(r[0]!.x).toBe(50);
    expect(r[1]!.x).toBe(0);
  });
});

describe('FlexLayoutEngine — measure + absolute', () => {
  it('uses the measure callback for a leaf content size', () => {
    const leaf = node({ alignSelf: 'flex-start' }, [], { measure: () => ({ width: 80, height: 20 }) });
    const r = rects(node({ width: 300, height: 100, alignItems: 'flex-start' }, [leaf]));
    expect(r[0]!.width).toBe(80);
    expect(r[0]!.height).toBe(20);
  });

  it('positions an absolute child by its insets, ignoring flow', () => {
    const root = node({ width: 200, height: 200 }, [
      node({ width: 50 }),
      node({ position: 'absolute', left: 10, top: 20, width: 30, height: 40 }),
    ]);
    const result = engine.compute(root, { width: 200, height: 200 });
    // In-flow child unaffected.
    expect(result.children[0]!.rect.x).toBe(0);
    // Absolute child positioned by insets.
    expect(result.children[1]!.rect).toEqual({ x: 10, y: 20, width: 30, height: 40 });
  });

  it('stretches an absolute child between left+right when width is auto', () => {
    const root = node({ width: 200, height: 200 }, [
      node({ position: 'absolute', left: 10, right: 30, top: 0, height: 50 }),
    ]);
    const result = engine.compute(root, { width: 200, height: 200 });
    expect(result.children[0]!.rect.width).toBe(160); // 200 - 10 - 30
    expect(result.children[0]!.rect.x).toBe(10);
  });
});

describe('FlexLayoutEngine — nesting', () => {
  it('lays out a nested tree with per-level content boxes', () => {
    const root = node({ width: 200, height: 100, padding: 10 }, [
      node({ flexGrow: 1, padding: 5, flexDirection: 'column' }, [node({ height: 20 }), node({ height: 20 })]),
    ]);
    const result = engine.compute(root, { width: 200, height: 100 });
    const outer = result.children[0]!;
    // outer fills content box: width 180, height 80, at padding (10,10).
    expect(outer.rect).toEqual({ x: 10, y: 10, width: 180, height: 80 });
    // inner children are relative to outer's border box, inset by its padding 5.
    expect(outer.children[0]!.rect.x).toBe(5);
    expect(outer.children[0]!.rect.y).toBe(5);
    expect(outer.children[1]!.rect.y).toBe(25);
  });
});
