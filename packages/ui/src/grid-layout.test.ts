import { describe, expect, it } from 'bun:test';

import {
  computeGridLayout,
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
});
