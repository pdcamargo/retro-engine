import { describe, expect, it } from 'bun:test';

import {
  computeGridLayout,
  gridRowCount,
  gridTrackCount,
  type GridTracks,
  parseGridTemplate,
  placeGridItems,
  resolveGridTracks,
  type GridTrack,
} from './grid-layout';

const px = (value: number): GridTrack => ({ kind: 'px', value });
const fr = (value: number): GridTrack => ({ kind: 'fr', value });

describe('resolveGridTracks', () => {
  it('gives fixed px tracks their size', () => {
    expect(resolveGridTracks([px(30), px(50)], 200, 0)).toEqual([30, 50]);
  });

  it('splits leftover space among fr tracks by fraction', () => {
    // 200 wide, two 1fr → 100 each.
    expect(resolveGridTracks([fr(1), fr(1)], 200, 0)).toEqual([100, 100]);
    // 1fr + 3fr over 200 → 50, 150.
    expect(resolveGridTracks([fr(1), fr(3)], 200, 0)).toEqual([50, 150]);
  });

  it('subtracts fixed tracks and gaps before distributing fr', () => {
    // 200 wide, 40px + 1fr, gap 10 → fr gets 200 - 40 - 10 = 150.
    expect(resolveGridTracks([px(40), fr(1)], 200, 10)).toEqual([40, 150]);
  });

  it('clamps to zero when the template overflows', () => {
    expect(resolveGridTracks([px(300), fr(1)], 200, 0)).toEqual([300, 0]);
  });

  it('leaves fr tracks at zero when there are no fractions to size against', () => {
    expect(resolveGridTracks([], 100, 0)).toEqual([]);
  });

  it('grows a minmax(px, fr) track as an fr when there is room', () => {
    const mm = { kind: 'minmax' as const, min: 100, maxKind: 'fr' as const, maxValue: 1 };
    // Plenty of room: minmax(100px,1fr) + 1fr over 400 → 200 each (floor 100 does not bind).
    expect(resolveGridTracks([mm, fr(1)], 400, 0)).toEqual([200, 200]);
  });

  it('floors a minmax(px, fr) track at its min when space is tight, re-splitting the rest', () => {
    const mm = { kind: 'minmax' as const, min: 100, maxKind: 'fr' as const, maxValue: 1 };
    // 120 wide: fair share would be 60 < 100 → freeze at 100; the other 1fr gets 20.
    expect(resolveGridTracks([mm, fr(1)], 120, 0)).toEqual([100, 20]);
  });

  it('treats minmax(px, px) as its fixed min', () => {
    const mm = { kind: 'minmax' as const, min: 50, maxKind: 'px' as const, maxValue: 100 };
    expect(resolveGridTracks([mm, fr(1)], 200, 0)).toEqual([50, 150]);
  });
});

describe('parseGridTemplate', () => {
  it('parses fr and px (and bare-number) tokens', () => {
    expect(parseGridTemplate('1fr 2fr 40px')).toEqual([
      { kind: 'fr', value: 1 },
      { kind: 'fr', value: 2 },
      { kind: 'px', value: 40 },
    ]);
    expect(parseGridTemplate('32 1fr')).toEqual([
      { kind: 'px', value: 32 },
      { kind: 'fr', value: 1 },
    ]);
  });

  it('handles extra whitespace and yields nothing for an empty template', () => {
    expect(parseGridTemplate('   ')).toEqual([]);
    expect(parseGridTemplate('')).toEqual([]);
    expect(parseGridTemplate('  1fr   2fr ')).toEqual([
      { kind: 'fr', value: 1 },
      { kind: 'fr', value: 2 },
    ]);
  });

  it('skips malformed tokens', () => {
    expect(parseGridTemplate('1fr auto 2fr')).toEqual([
      { kind: 'fr', value: 1 },
      { kind: 'fr', value: 2 },
    ]);
  });

  it('parses minmax(px, fr) / minmax(px, px), keeping the token whole across the comma space', () => {
    expect(parseGridTemplate('minmax(120px, 1fr) 1fr 40px')).toEqual([
      { kind: 'minmax', min: 120, maxKind: 'fr', maxValue: 1 },
      { kind: 'fr', value: 1 },
      { kind: 'px', value: 40 },
    ]);
    expect(parseGridTemplate('minmax(50px,200px)')).toEqual([
      { kind: 'minmax', min: 50, maxKind: 'px', maxValue: 200 },
    ]);
  });
});

describe('computeGridLayout', () => {
  it('lays out a 2×2 fr grid with gaps, row-major', () => {
    const grid = computeGridLayout(
      { columns: [fr(1), fr(1)], rows: [fr(1), fr(1)], columnGap: 10, rowGap: 10 },
      { width: 210, height: 210 },
    );
    // Each track: (210 - 10 gap) / 2 = 100.
    expect(grid.columnSizes).toEqual([100, 100]);
    expect(grid.rowSizes).toEqual([100, 100]);
    expect(grid.cells).toHaveLength(4);
    // Cell (0,0), (col 1,row 0), (col 0,row 1), (1,1).
    expect(grid.cells[0]).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    expect(grid.cells[1]).toEqual({ x: 110, y: 0, width: 100, height: 100 });
    expect(grid.cells[2]).toEqual({ x: 0, y: 110, width: 100, height: 100 });
    expect(grid.cells[3]).toEqual({ x: 110, y: 110, width: 100, height: 100 });
  });

  it('mixes fixed and fractional tracks', () => {
    const grid = computeGridLayout(
      { columns: [px(50), fr(1)], rows: [px(20)] },
      { width: 150, height: 100 },
    );
    expect(grid.columnSizes).toEqual([50, 100]);
    expect(grid.rowSizes).toEqual([20]);
    expect(grid.cells[0]).toEqual({ x: 0, y: 0, width: 50, height: 20 });
    expect(grid.cells[1]).toEqual({ x: 50, y: 0, width: 100, height: 20 });
  });
});

describe('placeGridItems', () => {
  // A 3-column × 2-row grid of 100px tracks, no gaps.
  const tracks: GridTracks = {
    columnSizes: [100, 100, 100],
    rowSizes: [100, 100],
    columnGap: 0,
    rowGap: 0,
  };

  it('places single-cell items sequentially, row-major', () => {
    const r = placeGridItems(tracks, [{}, {}, {}, {}]);
    expect(r[0]).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    expect(r[1]).toEqual({ x: 100, y: 0, width: 100, height: 100 });
    expect(r[2]).toEqual({ x: 200, y: 0, width: 100, height: 100 });
    expect(r[3]).toEqual({ x: 0, y: 100, width: 100, height: 100 }); // wrapped to row 2
  });

  it('spans columns and rows, sizing the rect across the tracks', () => {
    const r = placeGridItems(tracks, [{ colSpan: 2 }, { rowSpan: 2 }]);
    // item 0: cols 0-1 of row 0 → 200 wide.
    expect(r[0]).toEqual({ x: 0, y: 0, width: 200, height: 100 });
    // item 1: next free is col 2 row 0, spanning 2 rows → tall.
    expect(r[1]).toEqual({ x: 200, y: 0, width: 100, height: 200 });
  });

  it('skips occupied cells so a later item lands past a span', () => {
    // item 0 spans the whole first row; item 1 must drop to row 2.
    const r = placeGridItems(tracks, [{ colSpan: 3 }, {}]);
    expect(r[0]).toEqual({ x: 0, y: 0, width: 300, height: 100 });
    expect(r[1]).toEqual({ x: 0, y: 100, width: 100, height: 100 });
  });

  it('includes gaps in a span’s size', () => {
    const gapped: GridTracks = { columnSizes: [100, 100], rowSizes: [50], columnGap: 10, rowGap: 0 };
    const r = placeGridItems(gapped, [{ colSpan: 2 }]);
    expect(r[0]).toEqual({ x: 0, y: 0, width: 210, height: 50 }); // 100 + 10 gap + 100
  });

  it('gives an item that fits nowhere a zero-size rect', () => {
    const r = placeGridItems(tracks, [{ colSpan: 3 }, { colSpan: 3 }, { colSpan: 3 }]);
    expect(r[0]!.width).toBe(300);
    expect(r[1]!.width).toBe(300);
    expect(r[2]).toEqual({ x: 0, y: 0, width: 0, height: 0 }); // grid full
  });

  it('places an explicit item at its line, and auto items flow around it', () => {
    // Explicit item at column line 2, row line 1 (0-based col 1, row 0); one auto item.
    const r = placeGridItems(tracks, [{ colStart: 2, rowStart: 1 }, {}]);
    expect(r[0]).toEqual({ x: 100, y: 0, width: 100, height: 100 }); // col 1, row 0
    expect(r[1]).toEqual({ x: 0, y: 0, width: 100, height: 100 }); // auto → col 0 (skips the reserved cell)
  });

  it('honors an explicit start + span (grid-column: 1 / 3 style)', () => {
    const r = placeGridItems(tracks, [{ colStart: 1, rowStart: 2, colSpan: 2 }]);
    expect(r[0]).toEqual({ x: 0, y: 100, width: 200, height: 100 }); // cols 0-1 of row 1
  });

  it('clamps an explicit column so its span fits the grid width', () => {
    // Start line 3 (col 2) with span 2 in a 3-col grid would overflow → clamped to col 1.
    const r = placeGridItems(tracks, [{ colStart: 3, rowStart: 1, colSpan: 2 }]);
    expect(r[0]).toEqual({ x: 100, y: 0, width: 200, height: 100 }); // cols 1-2
  });

  it('fills columns first with grid-auto-flow: column', () => {
    // 3 cols × 2 rows, column flow → item order goes down col 0, then col 1, …
    const r = placeGridItems(tracks, [{}, {}, {}, {}], 'column');
    expect(r[0]).toEqual({ x: 0, y: 0, width: 100, height: 100 }); // col 0, row 0
    expect(r[1]).toEqual({ x: 0, y: 100, width: 100, height: 100 }); // col 0, row 1
    expect(r[2]).toEqual({ x: 100, y: 0, width: 100, height: 100 }); // col 1, row 0
    expect(r[3]).toEqual({ x: 100, y: 100, width: 100, height: 100 }); // col 1, row 1
  });

  it('honors a row span under column flow', () => {
    // First item spans both rows of column 0; the next drops to column 1.
    const r = placeGridItems(tracks, [{ rowSpan: 2 }, {}], 'column');
    expect(r[0]).toEqual({ x: 0, y: 0, width: 100, height: 200 });
    expect(r[1]).toEqual({ x: 100, y: 0, width: 100, height: 100 });
  });
});

describe('gridTrackCount', () => {
  it('counts rows for row flow, columns for column flow', () => {
    expect(gridTrackCount(2, [{}, {}, {}, {}, {}], 'row')).toBe(3); // 5 items / 2 cols
    expect(gridTrackCount(2, [{}, {}, {}, {}, {}], 'column')).toBe(3); // 5 items / 2 rows
    expect(gridTrackCount(3, [{}, {}, {}, {}, {}], 'column')).toBe(2); // 5 items / 3 rows
  });
});

describe('gridRowCount', () => {
  it('counts the rows sparse placement needs (unbounded)', () => {
    expect(gridRowCount(2, [{}, {}, {}, {}, {}])).toBe(3); // 5 items / 2 cols → 3 rows
    expect(gridRowCount(3, [{}, {}, {}])).toBe(1);
    expect(gridRowCount(3, [])).toBe(0);
  });

  it('accounts for spans when growing rows', () => {
    // A row-2 span in col 0, then 3 single cells across 2 cols.
    expect(gridRowCount(2, [{ rowSpan: 2 }, {}, {}, {}])).toBe(3);
    // A full-width span forces the next item onto a new row.
    expect(gridRowCount(2, [{ colSpan: 2 }, {}])).toBe(2);
  });

  it('is zero rows for zero columns', () => {
    expect(gridRowCount(0, [{}, {}])).toBe(0);
  });

  it('counts rows an explicit item reaches (so auto-rows can hold it)', () => {
    expect(gridRowCount(2, [{ colStart: 1, rowStart: 3 }])).toBe(3); // explicit at row line 3
    expect(gridRowCount(2, [{ colStart: 1, rowStart: 2, rowSpan: 2 }])).toBe(3); // rows 2-3
  });
});
