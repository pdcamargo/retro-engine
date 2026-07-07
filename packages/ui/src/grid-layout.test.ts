import { describe, expect, it } from 'bun:test';

import { computeGridLayout, resolveGridTracks, type GridTrack } from './grid-layout';

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
