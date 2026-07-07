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

/** A grid template: column + row tracks and the gaps between them (pixels). */
export interface GridSpec {
  readonly columns: readonly GridTrack[];
  readonly rows: readonly GridTrack[];
  /** Gap between columns, in pixels. Default `0`. */
  readonly columnGap?: number;
  /** Gap between rows, in pixels. Default `0`. */
  readonly rowGap?: number;
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
