import type { Vec4 } from '@retro-engine/math';

/** Direction the main axis runs; cross axis is perpendicular. Mirrors CSS. */
export type FlexDirection = 'row' | 'row-reverse' | 'column' | 'column-reverse';

/** Distribution of leftover space along the main axis. Mirrors CSS. */
export type JustifyContent =
  | 'flex-start'
  | 'flex-end'
  | 'center'
  | 'space-between'
  | 'space-around'
  | 'space-evenly';

/** Alignment of items along the cross axis. Mirrors CSS (minus `baseline`). */
export type AlignItems = 'flex-start' | 'flex-end' | 'center' | 'stretch';

/** Per-item cross-axis alignment; `'auto'` defers to the parent's `alignItems`. */
export type AlignSelf = 'auto' | AlignItems;

/**
 * A node's layout mode for its in-flow children:
 * - `'flex'` — flexbox (the default).
 * - `'grid'` — CSS grid, sized by {@link UiStyle.gridTemplateColumns} /
 *   {@link UiStyle.gridTemplateRows}; children fill cells row-major.
 */
export type Display = 'flex' | 'grid';

/** In-flow (`'relative'`) or taken out of flow and positioned by insets. */
export type PositionType = 'relative' | 'absolute';

/**
 * A length: a finite number of logical pixels, or `undefined` — **auto**
 * (content-derived on a size; ignored on an inset). `undefined` is used rather
 * than the CSS keyword `'auto'` so the value reflects/serializes cleanly as an
 * optional number. Percentages are not supported yet.
 */
export type Dimension = number | undefined;

/** Four-sided lengths in logical pixels (padding / margin). */
export interface Edges {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/**
 * Resolved layout style for a single UI node — a flat, fully-specified snapshot
 * (every field present) that the {@link import('./layout-engine').LayoutEngine}
 * consumes. Authoring shorthands live in {@link makeStyle}; the layout algorithm
 * always sees the complete struct so it never has to guess a default.
 */
export interface UiStyle {
  /** Layout mode for in-flow children. Default `'flex'`. */
  readonly display: Display;
  /**
   * Grid column tracks as a CSS-like template (e.g. `"1fr 2fr 40px"`), parsed at
   * layout time. Empty means no columns. Used only when {@link display} is
   * `'grid'`; the `gap` applies between both grid columns and rows.
   */
  readonly gridTemplateColumns: string;
  /** Grid row tracks, same syntax as {@link gridTemplateColumns}. */
  readonly gridTemplateRows: string;
  /** Columns this node spans when it is a grid item (CSS `grid-column: span N`). Default `1`. */
  readonly gridColumnSpan: number;
  /** Rows this node spans when it is a grid item (CSS `grid-row: span N`). Default `1`. */
  readonly gridRowSpan: number;
  readonly flexDirection: FlexDirection;
  readonly justifyContent: JustifyContent;
  readonly alignItems: AlignItems;
  readonly alignSelf: AlignSelf;
  /**
   * Default alignment of grid items along the **inline (column / horizontal)**
   * axis within their cell (CSS `justify-items`). Used only when {@link display}
   * is `'grid'`; `alignItems` is the block (row / vertical) axis for grid.
   * `'stretch'` (the default) fills the cell width; a per-item {@link justifySelf}
   * overrides it.
   */
  readonly justifyItems: AlignItems;
  /**
   * This grid item's own inline-axis alignment within its cell (CSS
   * `justify-self`); `'auto'` defers to the parent's {@link justifyItems}.
   */
  readonly justifySelf: AlignSelf;
  /** Share of positive free space this item takes (CSS `flex-grow`). */
  readonly flexGrow: number;
  /** Share of negative free space removed from this item (CSS `flex-shrink`). */
  readonly flexShrink: number;
  /** Base main size before grow/shrink; `'auto'` uses the main size / content. */
  readonly flexBasis: Dimension;
  readonly width: Dimension;
  readonly height: Dimension;
  readonly minWidth: number;
  /** Upper bound in pixels; `undefined` means no maximum. */
  readonly maxWidth: number | undefined;
  readonly minHeight: number;
  /** Upper bound in pixels; `undefined` means no maximum. */
  readonly maxHeight: number | undefined;
  readonly padding: Edges;
  readonly margin: Edges;
  /** Space between adjacent in-flow children along the main axis, in pixels. */
  readonly gap: number;
  readonly position: PositionType;
  readonly left: Dimension;
  readonly right: Dimension;
  readonly top: Dimension;
  readonly bottom: Dimension;
  /**
   * Solid fill drawn behind the node's border box, as linear RGBA in `[0, 1]`.
   * `undefined` (the default) draws no background. A paint property — ignored by
   * layout, consumed by the UI render layer.
   */
  readonly backgroundColor: Vec4 | undefined;
  /**
   * Border thickness per side, in logical pixels, drawn *inside* the border box
   * (CSS `border-box`). Zero (the default) draws no border. A paint property —
   * ignored by layout for now (it does not inset content).
   */
  readonly borderWidth: Edges;
  /**
   * Border fill, linear RGBA in `[0, 1]`. `undefined` (the default) draws no
   * border regardless of {@link borderWidth}.
   */
  readonly borderColor: Vec4 | undefined;
}

const ZERO_EDGES: Edges = { left: 0, right: 0, top: 0, bottom: 0 };

/** A fresh, fully-defaulted {@link UiStyle} matching CSS flex-item defaults. */
export const defaultUiStyle = (): UiStyle => ({
  display: 'flex',
  gridTemplateColumns: '',
  gridTemplateRows: '',
  gridColumnSpan: 1,
  gridRowSpan: 1,
  flexDirection: 'row',
  justifyContent: 'flex-start',
  alignItems: 'stretch',
  alignSelf: 'auto',
  justifyItems: 'stretch',
  justifySelf: 'auto',
  flexGrow: 0,
  flexShrink: 1,
  flexBasis: undefined,
  width: undefined,
  height: undefined,
  minWidth: 0,
  maxWidth: undefined,
  minHeight: 0,
  maxHeight: undefined,
  padding: ZERO_EDGES,
  margin: ZERO_EDGES,
  gap: 0,
  position: 'relative',
  left: undefined,
  right: undefined,
  top: undefined,
  bottom: undefined,
  backgroundColor: undefined,
  borderWidth: ZERO_EDGES,
  borderColor: undefined,
});

/** Authoring shorthand: a scalar (all four sides) or partial per-side edges. */
export type EdgesInit = number | Partial<Edges>;

const resolveEdges = (init: EdgesInit | undefined, base: Edges): Edges => {
  if (init === undefined) return base;
  if (typeof init === 'number') return { left: init, right: init, top: init, bottom: init };
  return {
    left: init.left ?? base.left,
    right: init.right ?? base.right,
    top: init.top ?? base.top,
    bottom: init.bottom ?? base.bottom,
  };
};

/** Partial style with edge shorthands, accepted by {@link makeStyle}. */
export type UiStyleInit = Partial<Omit<UiStyle, 'padding' | 'margin' | 'borderWidth'>> & {
  padding?: EdgesInit;
  margin?: EdgesInit;
  borderWidth?: EdgesInit;
};

/**
 * Build a complete {@link UiStyle} from a partial init, filling every omitted
 * field with its default and expanding scalar `padding` / `margin` /
 * `borderWidth` shorthands to four-sided edges.
 */
export const makeStyle = (init: UiStyleInit = {}): UiStyle => {
  const base = defaultUiStyle();
  const { padding, margin, borderWidth, ...rest } = init;
  return {
    ...base,
    ...rest,
    padding: resolveEdges(padding, base.padding),
    margin: resolveEdges(margin, base.margin),
    borderWidth: resolveEdges(borderWidth, base.borderWidth),
  };
};

/** Whether a {@link FlexDirection} runs along the horizontal (row) axis. */
export const isRow = (direction: FlexDirection): boolean =>
  direction === 'row' || direction === 'row-reverse';

/** Whether a {@link FlexDirection} is reversed. */
export const isReverse = (direction: FlexDirection): boolean =>
  direction === 'row-reverse' || direction === 'column-reverse';
