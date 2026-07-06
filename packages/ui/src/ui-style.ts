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

/** In-flow (`'relative'`) or taken out of flow and positioned by insets. */
export type PositionType = 'relative' | 'absolute';

/**
 * A length: a finite number of logical pixels, or `'auto'` (content-derived on a
 * size, flexible/ignored on an inset). Percentages are not supported yet.
 */
export type Dimension = number | 'auto';

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
  readonly flexDirection: FlexDirection;
  readonly justifyContent: JustifyContent;
  readonly alignItems: AlignItems;
  readonly alignSelf: AlignSelf;
  /** Share of positive free space this item takes (CSS `flex-grow`). */
  readonly flexGrow: number;
  /** Share of negative free space removed from this item (CSS `flex-shrink`). */
  readonly flexShrink: number;
  /** Base main size before grow/shrink; `'auto'` uses the main size / content. */
  readonly flexBasis: Dimension;
  readonly width: Dimension;
  readonly height: Dimension;
  readonly minWidth: number;
  readonly maxWidth: number;
  readonly minHeight: number;
  readonly maxHeight: number;
  readonly padding: Edges;
  readonly margin: Edges;
  /** Space between adjacent in-flow children along the main axis, in pixels. */
  readonly gap: number;
  readonly position: PositionType;
  readonly left: Dimension;
  readonly right: Dimension;
  readonly top: Dimension;
  readonly bottom: Dimension;
}

const ZERO_EDGES: Edges = { left: 0, right: 0, top: 0, bottom: 0 };

/** A fresh, fully-defaulted {@link UiStyle} matching CSS flex-item defaults. */
export const defaultUiStyle = (): UiStyle => ({
  flexDirection: 'row',
  justifyContent: 'flex-start',
  alignItems: 'stretch',
  alignSelf: 'auto',
  flexGrow: 0,
  flexShrink: 1,
  flexBasis: 'auto',
  width: 'auto',
  height: 'auto',
  minWidth: 0,
  maxWidth: Number.POSITIVE_INFINITY,
  minHeight: 0,
  maxHeight: Number.POSITIVE_INFINITY,
  padding: ZERO_EDGES,
  margin: ZERO_EDGES,
  gap: 0,
  position: 'relative',
  left: 'auto',
  right: 'auto',
  top: 'auto',
  bottom: 'auto',
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
export type UiStyleInit = Partial<Omit<UiStyle, 'padding' | 'margin'>> & {
  padding?: EdgesInit;
  margin?: EdgesInit;
};

/**
 * Build a complete {@link UiStyle} from a partial init, filling every omitted
 * field with its default and expanding scalar `padding` / `margin` shorthands to
 * four-sided edges.
 */
export const makeStyle = (init: UiStyleInit = {}): UiStyle => {
  const base = defaultUiStyle();
  const { padding, margin, ...rest } = init;
  return {
    ...base,
    ...rest,
    padding: resolveEdges(padding, base.padding),
    margin: resolveEdges(margin, base.margin),
  };
};

/** Whether a {@link FlexDirection} runs along the horizontal (row) axis. */
export const isRow = (direction: FlexDirection): boolean =>
  direction === 'row' || direction === 'row-reverse';

/** Whether a {@link FlexDirection} is reversed. */
export const isReverse = (direction: FlexDirection): boolean =>
  direction === 'row-reverse' || direction === 'column-reverse';
