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

describe('FlexLayoutEngine — display: grid', () => {
  it('places children into a 2×2 fr grid, row-major, filling cells', () => {
    const r = rects(
      node({ width: 200, height: 200, display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr' }, [
        node({}),
        node({}),
        node({}),
        node({}),
      ]),
    );
    expect(r[0]).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    expect(r[1]).toEqual({ x: 100, y: 0, width: 100, height: 100 });
    expect(r[2]).toEqual({ x: 0, y: 100, width: 100, height: 100 });
    expect(r[3]).toEqual({ x: 100, y: 100, width: 100, height: 100 });
  });

  it('honors gap and mixed px/fr tracks, and offsets by the container padding', () => {
    const r = rects(
      node(
        {
          width: 200,
          height: 100,
          padding: 10,
          gap: 10,
          display: 'grid',
          gridTemplateColumns: '40px 1fr',
          gridTemplateRows: '1fr',
        },
        [node({}), node({})],
      ),
    );
    // content box: 180×80 after padding 10. columns: 40 + gap 10 + fr(180-40-10=130).
    expect(r[0]).toEqual({ x: 10, y: 10, width: 40, height: 80 });
    expect(r[1]).toEqual({ x: 10 + 40 + 10, y: 10, width: 130, height: 80 });
  });

  it('gives a child past the last cell a zero-size rect (no auto-rows yet)', () => {
    const r = rects(
      node({ width: 100, height: 100, display: 'grid', gridTemplateColumns: '1fr', gridTemplateRows: '1fr' }, [
        node({}),
        node({}),
      ]),
    );
    expect(r[0]).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    expect(r[1]!.width).toBe(0);
    expect(r[1]!.height).toBe(0);
  });

  it('spans a grid child across columns; later children fill remaining cells', () => {
    const r = rects(
      node({ width: 200, height: 200, display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr' }, [
        node({ gridColumnSpan: 2 }), // spans both columns of row 0
        node({}),
        node({}),
      ]),
    );
    expect(r[0]).toEqual({ x: 0, y: 0, width: 200, height: 100 });
    expect(r[1]).toEqual({ x: 0, y: 100, width: 100, height: 100 });
    expect(r[2]).toEqual({ x: 100, y: 100, width: 100, height: 100 });
  });

  it('aligns a sized item within its cell via justify-items / align-items (center)', () => {
    const r = rects(
      node(
        {
          width: 100,
          height: 100,
          display: 'grid',
          gridTemplateColumns: '1fr',
          gridTemplateRows: '1fr',
          justifyItems: 'center',
          alignItems: 'center',
        },
        [node({ width: 40, height: 20 })],
      ),
    );
    // 40×20 item centered in the 100×100 cell → offset (30, 40).
    expect(r[0]).toEqual({ x: 30, y: 40, width: 40, height: 20 });
  });

  it('places a sized item at the cell end on both axes (flex-end)', () => {
    const r = rects(
      node(
        {
          width: 100,
          height: 100,
          display: 'grid',
          gridTemplateColumns: '1fr',
          gridTemplateRows: '1fr',
          justifyItems: 'flex-end',
          alignItems: 'flex-end',
        },
        [node({ width: 40, height: 20 })],
      ),
    );
    expect(r[0]).toEqual({ x: 60, y: 80, width: 40, height: 20 });
  });

  it('lets justify-self / align-self override the container defaults per item', () => {
    const r = rects(
      node(
        {
          width: 100,
          height: 100,
          display: 'grid',
          gridTemplateColumns: '1fr',
          gridTemplateRows: '1fr',
          justifyItems: 'flex-start',
          alignItems: 'flex-start',
        },
        [node({ width: 40, height: 20, justifySelf: 'center', alignSelf: 'flex-end' })],
      ),
    );
    // justify-self center → x=30; align-self flex-end → y=80.
    expect(r[0]).toEqual({ x: 30, y: 80, width: 40, height: 20 });
  });

  it('flows items into implicit auto-rows when there are no explicit rows', () => {
    const r = rects(
      node(
        {
          width: 200,
          height: 200,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gridAutoRows: 40, // implicit rows, 40px tall
        },
        [node({}), node({}), node({}), node({})],
      ),
    );
    expect(r[0]).toEqual({ x: 0, y: 0, width: 100, height: 40 });
    expect(r[1]).toEqual({ x: 100, y: 0, width: 100, height: 40 });
    expect(r[2]).toEqual({ x: 0, y: 40, width: 100, height: 40 });
    expect(r[3]).toEqual({ x: 100, y: 40, width: 100, height: 40 });
  });

  it('appends implicit rows past the explicit rows (fr + auto-row interplay)', () => {
    const r = rects(
      node(
        {
          width: 100,
          height: 100,
          display: 'grid',
          gridTemplateColumns: '1fr',
          gridTemplateRows: '1fr',
          gridAutoRows: 30,
        },
        [node({}), node({})],
      ),
    );
    // explicit fr row takes 100 − 30 (implicit px) = 70; implicit row is 30.
    expect(r[0]).toEqual({ x: 0, y: 0, width: 100, height: 70 });
    expect(r[1]).toEqual({ x: 0, y: 70, width: 100, height: 30 });
  });

  it('centers a fixed track block in a larger container (justify/align-content)', () => {
    const r = rects(
      node(
        {
          width: 200,
          height: 200,
          display: 'grid',
          gridTemplateColumns: '40px 40px', // used 80 wide
          gridTemplateRows: '40px', // used 40 tall
          justifyContent: 'center',
          alignContent: 'center',
        },
        [node({}), node({})],
      ),
    );
    // Track block 80×40 centered in 200×200 → leading offset (60, 80).
    expect(r[0]).toEqual({ x: 60, y: 80, width: 40, height: 40 });
    expect(r[1]).toEqual({ x: 100, y: 80, width: 40, height: 40 });
  });

  it('pushes a fixed track block to the far edge (flex-end content)', () => {
    const r = rects(
      node(
        {
          width: 100,
          height: 100,
          display: 'grid',
          gridTemplateColumns: '30px',
          gridTemplateRows: '20px',
          justifyContent: 'flex-end',
          alignContent: 'flex-end',
        },
        [node({})],
      ),
    );
    // 30×20 pushed to bottom-right of 100×100 → (70, 80).
    expect(r[0]).toEqual({ x: 70, y: 80, width: 30, height: 20 });
  });

  it('places an explicitly-positioned child at its grid lines; auto children flow around it', () => {
    const r = rects(
      node({ width: 200, height: 200, display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr' }, [
        node({ gridColumnStart: 2, gridRowStart: 1 }), // explicit: col 2, row 1
        node({}),
        node({}),
        node({}),
      ]),
    );
    expect(r[0]).toEqual({ x: 100, y: 0, width: 100, height: 100 }); // explicit cell (col 1, row 0)
    expect(r[1]).toEqual({ x: 0, y: 0, width: 100, height: 100 }); // auto → the free col 0 of row 0
    expect(r[2]).toEqual({ x: 0, y: 100, width: 100, height: 100 }); // row 1
    expect(r[3]).toEqual({ x: 100, y: 100, width: 100, height: 100 });
  });

  it('mixes a stretched axis with an aligned axis (stretch width, center height)', () => {
    const r = rects(
      node(
        {
          width: 100,
          height: 100,
          display: 'grid',
          gridTemplateColumns: '1fr',
          gridTemplateRows: '1fr',
          alignItems: 'center', // justify-items defaults to stretch
        },
        [node({ height: 20 })],
      ),
    );
    // width stretches to the cell (100), height 20 centered vertically → y=40.
    expect(r[0]).toEqual({ x: 0, y: 40, width: 100, height: 20 });
  });
});
