import type { LayoutRect } from './layout-engine';

/**
 * A grid track size — one column width or row height in a template:
 * - `{ kind: 'px', value }` — a fixed pixel size.
 * - `{ kind: 'fr', value }` — a fraction of the leftover space (CSS `fr`),
 *   distributed among all `fr` tracks in proportion to their values.
 *
 * (`auto` / `minmax` / content-based sizing are a later phase.)
 */
export type GridTrack = { readonly kind: 'px'; readonly value: number } | { readonly kind: 'fr'; readonly value: number };

/**
 * Parse a CSS-like track template into {@link GridTrack}s: whitespace-separated
 * tokens where `<n>fr` is a fraction and `<n>px` / a bare `<n>` is a fixed pixel
 * size (e.g. `"1fr 2fr 40px"` → `[fr 1, fr 2, px 40]`). Unrecognized tokens are
 * skipped, so an empty or malformed template yields no tracks. Pure.
 */
export const parseGridTemplate = (template: string): GridTrack[] => {
  const out: GridTrack[] = [];
  for (const token of template.trim().split(/\s+/)) {
    if (token === '') continue;
    if (token.endsWith('fr')) {
      const v = Number.parseFloat(token.slice(0, -2));
      if (Number.isFinite(v)) out.push({ kind: 'fr', value: v });
    } else {
      const v = Number.parseFloat(token.endsWith('px') ? token.slice(0, -2) : token);
      if (Number.isFinite(v)) out.push({ kind: 'px', value: v });
    }
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

/** A placed grid item's span (in tracks). `1` (the default) is a single cell. */
export interface GridItem {
  readonly colSpan?: number;
  readonly rowSpan?: number;
}

/** The resolved geometry of a grid: pixel sizes of every column / row and each cell's rect. */
export interface GridLayout {
  readonly columnSizes: readonly number[];
  readonly rowSizes: readonly number[];
  /** One rect per cell, row-major (`index = row * columns + col`), relative to the grid's content box. */
  readonly cells: readonly LayoutRect[];
}

/**
 * Resolve a track template into pixel sizes for `available` space: fixed `px`
 * tracks take their size, then the leftover (after gaps) is split among `fr`
 * tracks in proportion to their fractions. Leftover is clamped at `0` (an
 * over-full template gives `fr` tracks `0`). Pure.
 */
export const resolveGridTracks = (
  tracks: readonly GridTrack[],
  available: number,
  gap: number,
): number[] => {
  if (tracks.length === 0) return [];
  const totalGap = gap * (tracks.length - 1);
  let pxSum = 0;
  let frSum = 0;
  for (const t of tracks) {
    if (t.kind === 'px') pxSum += Math.max(0, t.value);
    else frSum += Math.max(0, t.value);
  }
  const free = Math.max(0, available - pxSum - totalGap);
  const perFr = frSum > 0 ? free / frSum : 0;
  return tracks.map((t) => (t.kind === 'px' ? Math.max(0, t.value) : Math.max(0, t.value) * perFr));
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

/**
 * Place `items` into a resolved grid by CSS-style sparse auto-placement: scan
 * cells row-major and drop each item at the first free top-left cell where its
 * `colSpan × rowSpan` block fits and is unoccupied, marking those cells used.
 * Returns one `LayoutRect` per item (spanning rect); an item that fits nowhere
 * (grid full, or larger than the grid) gets a zero-size rect. Pure — the
 * placement half of grid layout, unit-tested. Spans are clamped to `≥ 1` and to
 * the grid's track counts.
 */
export const placeGridItems = (grid: GridTracks, items: readonly GridItem[]): LayoutRect[] => {
  const cols = grid.columnSizes.length;
  const rows = grid.rowSizes.length;
  const colOff = trackOffsets(grid.columnSizes, grid.columnGap);
  const rowOff = trackOffsets(grid.rowSizes, grid.rowGap);
  const occupied = new Array<boolean>(cols * rows).fill(false);

  const fits = (c: number, r: number, cs: number, rs: number): boolean => {
    if (c + cs > cols || r + rs > rows) return false;
    for (let rr = r; rr < r + rs; rr += 1) {
      for (let cc = c; cc < c + cs; cc += 1) if (occupied[rr * cols + cc]) return false;
    }
    return true;
  };

  const rects: LayoutRect[] = [];
  for (const item of items) {
    const cs = Math.max(1, Math.min(cols, item.colSpan ?? 1));
    const rs = Math.max(1, Math.min(rows, item.rowSpan ?? 1));
    let placed = false;
    for (let r = 0; r < rows && !placed; r += 1) {
      for (let c = 0; c < cols && !placed; c += 1) {
        if (!fits(c, r, cs, rs)) continue;
        for (let rr = r; rr < r + rs; rr += 1) {
          for (let cc = c; cc < c + cs; cc += 1) occupied[rr * cols + cc] = true;
        }
        rects.push({
          x: colOff[c]!,
          y: rowOff[r]!,
          width: spanSize(grid.columnSizes, grid.columnGap, c, cs),
          height: spanSize(grid.rowSizes, grid.rowGap, r, rs),
        });
        placed = true;
      }
    }
    if (!placed) rects.push({ x: 0, y: 0, width: 0, height: 0 });
  }
  return rects;
};
