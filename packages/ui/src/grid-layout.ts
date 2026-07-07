import type { LayoutRect } from './layout-engine';

/**
 * A grid track size — one column width or row height in a template:
 * - `{ kind: 'px', value }` — a fixed pixel size.
 * - `{ kind: 'fr', value }` — a fraction of the leftover space (CSS `fr`),
 *   distributed among all `fr` tracks in proportion to their values.
 * - `{ kind: 'minmax', min, maxKind, maxValue }` — CSS `minmax(<px>, <px|fr>)`:
 *   a track sized at least `min` px. With an `fr` max it grows like that `fr`
 *   track but never below `min`; with a `px` max it takes `min` (content-based
 *   growth within `[min, max]` waits for `auto` sizing).
 *
 * (`auto` / content-based sizing are a later phase.)
 */
export type GridTrack =
  | { readonly kind: 'px'; readonly value: number }
  | { readonly kind: 'fr'; readonly value: number }
  | { readonly kind: 'minmax'; readonly min: number; readonly maxKind: 'px' | 'fr'; readonly maxValue: number }
  /** `auto` — content-sized. The layout engine resolves it to a pixel size (max
   * intrinsic size of the single-span items in the track) before sizing the rest. */
  | { readonly kind: 'auto' };

/** Parse one simple track token (`<n>fr` or `<n>px` / bare `<n>`), or `null`. */
const parseSimpleTrack = (token: string): { kind: 'px' | 'fr'; value: number } | null => {
  if (token.endsWith('fr')) {
    const v = Number.parseFloat(token.slice(0, -2));
    return Number.isFinite(v) ? { kind: 'fr', value: v } : null;
  }
  const v = Number.parseFloat(token.endsWith('px') ? token.slice(0, -2) : token);
  return Number.isFinite(v) ? { kind: 'px', value: v } : null;
};

/** Parse one track token: `auto`, a `minmax(a, b)`, or a simple `<n>fr` / `<n>px`. `null` if unrecognized. */
const parseTrack = (token: string): GridTrack | null => {
  if (token === 'auto') return { kind: 'auto' };
  if (token.startsWith('minmax(') && token.endsWith(')')) {
    const parts = token.slice(7, -1).split(',');
    if (parts.length !== 2) return null;
    const min = parseSimpleTrack(parts[0]!.trim());
    const max = parseSimpleTrack(parts[1]!.trim());
    if (min === null || max === null || min.kind !== 'px') return null;
    return { kind: 'minmax', min: min.value, maxKind: max.kind, maxValue: max.value };
  }
  return parseSimpleTrack(token);
};

/**
 * Parse a CSS-like track template into {@link GridTrack}s: whitespace-separated
 * tokens where `<n>fr` is a fraction, `<n>px` / a bare `<n>` is a fixed pixel
 * size, and `minmax(<px>, <px|fr>)` is a floored track (e.g.
 * `"minmax(120px, 1fr) 1fr 40px"`). `minmax(...)` is kept whole even with an inner
 * space after the comma. Unrecognized tokens are skipped. Pure.
 */
export const parseGridTemplate = (template: string): GridTrack[] => {
  const out: GridTrack[] = [];
  for (const token of template.trim().match(/minmax\([^)]*\)|\S+/g) ?? []) {
    const track = parseTrack(token);
    if (track !== null) out.push(track);
  }
  return out;
};

/** A grid template: column + row tracks and the gaps between them (pixels). */
export interface GridSpec {
  readonly columns: readonly GridTrack[];
  readonly rows: readonly GridTrack[];
  /** Gap between columns, in pixels. Default `0`. */
  readonly columnGap?: number;
  /** Gap between rows, in pixels. Default `0`. */
  readonly rowGap?: number;
}

/**
 * A grid item's placement inputs. `colSpan` / `rowSpan` are the track spans
 * (default `1`). `colStart` / `rowStart` are 1-based **explicit** line positions
 * (CSS `grid-column: <line>`): when both are set (`≥ 1`) the item is placed at
 * that cell instead of auto-flowed; `0` / omitted means auto on that axis.
 */
export interface GridItem {
  readonly colSpan?: number;
  readonly rowSpan?: number;
  readonly colStart?: number;
  readonly rowStart?: number;
}

/** The resolved geometry of a grid: pixel sizes of every column / row and each cell's rect. */
export interface GridLayout {
  readonly columnSizes: readonly number[];
  readonly rowSizes: readonly number[];
  /** One rect per cell, row-major (`index = row * columns + col`), relative to the grid's content box. */
  readonly cells: readonly LayoutRect[];
}

/** Per-track resolution state during {@link resolveGridTracks}. */
interface TrackResolve {
  /** Fixed pixel size (`px` tracks, and `minmax(px,px)` which takes its min). */
  readonly fixed: number;
  /** `fr` flex factor (plain `fr`, or a `minmax(px, Nfr)` growing as `N`); `0` if not flexible. */
  readonly flex: number;
  /** Lower bound the flexible size may not drop below (a `minmax` min); `0` otherwise. */
  readonly floor: number;
}

const classifyTrack = (t: GridTrack): TrackResolve => {
  if (t.kind === 'px') return { fixed: Math.max(0, t.value), flex: 0, floor: 0 };
  if (t.kind === 'fr') return { fixed: 0, flex: Math.max(0, t.value), floor: 0 };
  // An `auto` track that reached here was not content-resolved by the layout
  // engine; treat it as 0 (defensive — the engine substitutes it to `px` first).
  if (t.kind === 'auto') return { fixed: 0, flex: 0, floor: 0 };
  const min = Math.max(0, t.min);
  return t.maxKind === 'fr'
    ? { fixed: 0, flex: Math.max(0, t.maxValue), floor: min }
    : { fixed: min, flex: 0, floor: 0 }; // minmax(px, px) → its min (no growth source yet)
};

/**
 * Resolve a track template into pixel sizes for `available` space: fixed (`px`,
 * `minmax(px,px)`) tracks take their size, then the leftover (after gaps) is split
 * among `fr` tracks in proportion to their fractions — but a `minmax(px, Nfr)`
 * track never shrinks below its `min` (CSS floored-`fr`). Floored tracks that the
 * plain split would starve are frozen at their min and the rest re-split (the
 * iterative CSS algorithm). Leftover is clamped at `0`. Pure.
 */
export const resolveGridTracks = (
  tracks: readonly GridTrack[],
  available: number,
  gap: number,
): number[] => {
  if (tracks.length === 0) return [];
  const totalGap = gap * (tracks.length - 1);
  const parts = tracks.map(classifyTrack);
  const fixedSum = parts.reduce((s, p) => s + p.fixed, 0);
  const free = Math.max(0, available - fixedSum - totalGap);

  // Iteratively freeze floored fr tracks whose fair share would fall below their
  // floor, reserving the floor and re-splitting the rest among the others.
  const frozen = parts.map((p) => p.flex === 0); // non-flex are already "resolved"
  const frozenSize = parts.map((p) => (p.flex === 0 ? p.fixed : 0));
  for (;;) {
    let activeFlex = 0;
    let reservedFloor = 0;
    for (let i = 0; i < parts.length; i += 1) {
      if (frozen[i]) continue;
      activeFlex += parts[i]!.flex;
    }
    for (let i = 0; i < parts.length; i += 1) if (frozen[i] && parts[i]!.floor > 0) reservedFloor += frozenSize[i]!;
    const perFr = activeFlex > 0 ? Math.max(0, free - reservedFloor) / activeFlex : 0;
    let changed = false;
    for (let i = 0; i < parts.length; i += 1) {
      if (frozen[i]) continue;
      if (parts[i]!.floor > 0 && parts[i]!.flex * perFr < parts[i]!.floor) {
        frozen[i] = true;
        frozenSize[i] = parts[i]!.floor;
        changed = true;
      }
    }
    if (!changed) {
      return parts.map((p, i) => (frozen[i] ? frozenSize[i]! : p.flex * perFr));
    }
  }
};

/**
 * Compute a grid's resolved track sizes and per-cell rects for `available`
 * content space. Cells are laid out row-major from the top-left, offset by the
 * running track sizes + gaps. Pure — the core CSS-grid geometry, independent of
 * the ECS and the `LayoutEngine` tree wiring (a later phase places children into
 * these cells).
 */
export const computeGridLayout = (
  spec: GridSpec,
  available: { readonly width: number; readonly height: number },
): GridLayout => {
  const columnGap = spec.columnGap ?? 0;
  const rowGap = spec.rowGap ?? 0;
  const columnSizes = resolveGridTracks(spec.columns, available.width, columnGap);
  const rowSizes = resolveGridTracks(spec.rows, available.height, rowGap);

  const cells: LayoutRect[] = [];
  let y = 0;
  for (let r = 0; r < rowSizes.length; r += 1) {
    let x = 0;
    for (let c = 0; c < columnSizes.length; c += 1) {
      cells.push({ x, y, width: columnSizes[c]!, height: rowSizes[r]! });
      x += columnSizes[c]! + columnGap;
    }
    y += rowSizes[r]! + rowGap;
  }
  return { columnSizes, rowSizes, cells };
};

/** Track start offsets: `offsets[i]` is the pixel position where track `i` begins. */
const trackOffsets = (sizes: readonly number[], gap: number): number[] => {
  const offsets: number[] = [0];
  for (let i = 0; i < sizes.length; i += 1) offsets.push(offsets[i]! + sizes[i]! + gap);
  return offsets;
};

/** Total pixel size of `span` tracks starting at `start`, including the gaps between them. */
const spanSize = (sizes: readonly number[], gap: number, start: number, span: number): number => {
  let total = gap * (span - 1);
  for (let i = 0; i < span; i += 1) total += sizes[start + i]!;
  return total;
};

/** The resolved track sizes + gaps of a grid, the input `placeGridItems` needs. */
export interface GridTracks {
  readonly columnSizes: readonly number[];
  readonly rowSizes: readonly number[];
  readonly columnGap: number;
  readonly rowGap: number;
}

/** An item's assigned cell: its top-left track + span. `col < 0` means unplaced. */
export interface GridCell {
  readonly col: number;
  readonly row: number;
  readonly colSpan: number;
  readonly rowSpan: number;
}

const UNPLACED: GridCell = { col: -1, row: 0, colSpan: 0, rowSpan: 0 };

/**
 * Assign each item a cell. Items with **both** an explicit `colStart` and
 * `rowStart` (`≥ 1`) are placed there first (CSS explicit placement — they may
 * overlap each other); the rest auto-flow by CSS-style sparse row-major
 * placement, scanning top-to-bottom / left-to-right for the first free cell where
 * their `colSpan × rowSpan` block fits and skipping cells the explicit items
 * already occupy. Rows grow up to `maxRows` (`Infinity` = unbounded, for implicit
 * auto-rows); an item that fits within no allowed row is left unplaced
 * (`col: -1`). Column spans are clamped to `[1, colCount]`, row spans to `≥ 1`;
 * an explicit column is clamped so its span fits the width. Returns the cells
 * (index-aligned to `items`) plus the number of rows actually used.
 */
const assignRowMajor = (
  colCount: number,
  items: readonly GridItem[],
  maxRows: number,
): { cells: GridCell[]; rowCount: number } => {
  if (colCount <= 0) {
    return { cells: items.map(() => UNPLACED), rowCount: 0 };
  }

  const occupied: boolean[] = [];
  const occ = (r: number, c: number): boolean => occupied[r * colCount + c] === true;
  const mark = (r: number, c: number): void => {
    const i = r * colCount + c;
    while (occupied.length <= i) occupied.push(false);
    occupied[i] = true;
  };
  const markBlock = (r: number, c: number, cs: number, rs: number): void => {
    for (let rr = r; rr < r + rs; rr += 1) for (let cc = c; cc < c + cs; cc += 1) mark(rr, cc);
  };
  const fits = (c: number, r: number, cs: number, rs: number): boolean => {
    if (c + cs > colCount || r + rs > maxRows) return false;
    for (let rr = r; rr < r + rs; rr += 1) {
      for (let cc = c; cc < c + cs; cc += 1) if (occ(rr, cc)) return false;
    }
    return true;
  };

  const cells: (GridCell | null)[] = items.map(() => null);
  let rowCount = 0;

  // Pass 1: explicitly-positioned items (both axes). Placed at their line,
  // reserving their cells so auto items flow around them.
  items.forEach((item, i) => {
    const colStart = item.colStart ?? 0;
    const rowStart = item.rowStart ?? 0;
    if (colStart < 1 || rowStart < 1) return;
    const cs = Math.max(1, Math.min(colCount, item.colSpan ?? 1));
    const rs = Math.max(1, item.rowSpan ?? 1);
    const c = Math.max(0, Math.min(colStart - 1, colCount - cs));
    const r = rowStart - 1;
    if (r + rs > maxRows) {
      cells[i] = UNPLACED; // beyond the grid's rows (no implicit rows to hold it)
      return;
    }
    markBlock(r, c, cs, rs);
    cells[i] = { col: c, row: r, colSpan: cs, rowSpan: rs };
    rowCount = Math.max(rowCount, r + rs);
  });

  // Pass 2: auto-flow the remaining items into the first free fitting cell.
  items.forEach((item, i) => {
    if (cells[i] !== null) return;
    const cs = Math.max(1, Math.min(colCount, item.colSpan ?? 1));
    const rs = Math.max(1, item.rowSpan ?? 1);
    for (let r = 0; r + rs <= maxRows; r += 1) {
      for (let c = 0; c < colCount; c += 1) {
        if (!fits(c, r, cs, rs)) continue;
        markBlock(r, c, cs, rs);
        cells[i] = { col: c, row: r, colSpan: cs, rowSpan: rs };
        rowCount = Math.max(rowCount, r + rs);
        return;
      }
    }
    cells[i] = UNPLACED;
  });

  return { cells: cells.map((c) => c ?? UNPLACED), rowCount };
};

/** Auto-placement direction (CSS `grid-auto-flow`): fill rows first, or columns first. */
export type GridFlow = 'row' | 'column';

/** Swap an item's axes, so column-flow can reuse the row-major placer transposed. */
const transposeItem = (item: GridItem): GridItem => ({
  ...(item.rowSpan !== undefined ? { colSpan: item.rowSpan } : {}),
  ...(item.colSpan !== undefined ? { rowSpan: item.colSpan } : {}),
  ...(item.rowStart !== undefined ? { colStart: item.rowStart } : {}),
  ...(item.colStart !== undefined ? { rowStart: item.colStart } : {}),
});

/** Swap an assigned cell's axes back after a transposed placement. */
const transposeCell = (cell: GridCell): GridCell => ({
  col: cell.col < 0 ? -1 : cell.row,
  row: cell.col < 0 ? 0 : cell.col,
  colSpan: cell.rowSpan,
  rowSpan: cell.colSpan,
});

/**
 * Assign cells for either flow. `'row'` fills each row left-to-right then wraps
 * (fixed `colCount` columns, rows grow to `maxRows`). `'column'` fills each column
 * top-to-bottom then moves right (fixed `rowCount` rows, columns grow to
 * `maxCols`) — implemented by transposing onto the same tested row-major placer.
 * `growCount` is the number of tracks the growing axis actually used (rows for
 * `'row'`, columns for `'column'`).
 */
const assignByFlow = (
  colCount: number,
  rowCount: number,
  items: readonly GridItem[],
  flow: GridFlow,
): { cells: GridCell[]; growCount: number } => {
  if (flow === 'row') {
    const { cells, rowCount: growCount } = assignRowMajor(colCount, items, rowCount);
    return { cells, growCount };
  }
  const t = assignRowMajor(rowCount, items.map(transposeItem), colCount);
  return { cells: t.cells.map(transposeCell), growCount: t.rowCount };
};

/**
 * The cell each item is assigned (index-aligned to `items`) for a grid of
 * `colCount × rowCount` tracks under `flow`. Pure — lets the layout engine size
 * `auto` tracks (from the intrinsic size of their items) before resolving
 * geometry, without re-implementing placement.
 */
export const assignGridCells = (
  colCount: number,
  rowCount: number,
  items: readonly GridItem[],
  flow: GridFlow = 'row',
): GridCell[] => assignByFlow(colCount, rowCount, items, flow).cells;

/**
 * The number of tracks the sparse auto-placement of `items` needs on the growing
 * axis, unbounded — rows for `'row'` flow (across `fixedCount` columns), columns
 * for `'column'` flow (down `fixedCount` rows). Pure — lets the layout engine size
 * implicit tracks (`grid-auto-rows` / `grid-auto-columns`) before resolving
 * geometry.
 */
export const gridTrackCount = (
  fixedCount: number,
  items: readonly GridItem[],
  flow: GridFlow = 'row',
): number => {
  const src = flow === 'row' ? items : items.map(transposeItem);
  return assignRowMajor(fixedCount, src, Number.POSITIVE_INFINITY).rowCount;
};

/** The number of rows `'row'`-flow auto-placement needs across `colCount` columns. Pure. */
export const gridRowCount = (colCount: number, items: readonly GridItem[]): number =>
  gridTrackCount(colCount, items, 'row');

/**
 * Place `items` into a resolved grid by CSS-style sparse auto-placement, filling
 * rows (`flow: 'row'`, the default) or columns (`flow: 'column'`). Returns one
 * `LayoutRect` per item (its spanning rect); an item that fits nowhere gets a
 * zero-size rect. Pure — the placement half of grid layout, unit-tested.
 */
export const placeGridItems = (
  grid: GridTracks,
  items: readonly GridItem[],
  flow: GridFlow = 'row',
): LayoutRect[] => {
  const colOff = trackOffsets(grid.columnSizes, grid.columnGap);
  const rowOff = trackOffsets(grid.rowSizes, grid.rowGap);
  const { cells } = assignByFlow(grid.columnSizes.length, grid.rowSizes.length, items, flow);
  return cells.map((cell) =>
    cell.col < 0
      ? { x: 0, y: 0, width: 0, height: 0 }
      : {
          x: colOff[cell.col]!,
          y: rowOff[cell.row]!,
          width: spanSize(grid.columnSizes, grid.columnGap, cell.col, cell.colSpan),
          height: spanSize(grid.rowSizes, grid.rowGap, cell.row, cell.rowSpan),
        },
  );
};
