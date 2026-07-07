import type {
  AvailableSpace,
  LayoutEngine,
  LayoutNode,
  LayoutResult,
} from './layout-engine';
import { computeGridLayout, gridRowCount, parseGridTemplate, placeGridItems } from './grid-layout';
import { type AlignItems, isReverse, isRow, type JustifyContent, type UiStyle } from './ui-style';

const clamp = (v: number, min: number, max: number | undefined): number =>
  Math.min(Math.max(v, min), max ?? Number.POSITIVE_INFINITY);

interface Size {
  width: number;
  height: number;
}

interface FlexItem {
  child: LayoutNode;
  style: UiStyle;
  mainMargin: number;
  crossMargin: number;
  minMain: number;
  maxMain: number | undefined;
  grow: number;
  shrink: number;
  baseSize: number;
  hypoMain: number;
  mainSize: number;
  frozen: boolean;
  crossSize: number;
  align: AlignItems;
}

/**
 * A single-line flexbox {@link LayoutEngine} implementing the CSS main-axis flex
 * resolution (grow / shrink with min/max clamping and iterative freezing, per
 * CSS Flexible Box §9.7), `justify-content`, `align-items`/`align-self`, `gap`,
 * padding, margin, and `position: absolute` insets. Percentages, `flex-wrap`,
 * and `baseline` alignment are not implemented yet (a later phase).
 *
 * Pure: no ECS, no GPU. The ECS layout system builds a {@link LayoutNode} tree
 * from the entity hierarchy, runs this, and writes the results back.
 */
export class FlexLayoutEngine implements LayoutEngine {
  compute(root: LayoutNode, available: AvailableSpace): LayoutResult {
    const s = root.style;
    const width =
      s.width !== undefined
        ? clamp(s.width, s.minWidth, s.maxWidth)
        : clamp(available.width, s.minWidth, s.maxWidth);
    const height =
      s.height !== undefined
        ? clamp(s.height, s.minHeight, s.maxHeight)
        : clamp(available.height, s.minHeight, s.maxHeight);
    return layoutNode(root, width, height);
  }
}

/** Border-box intrinsic size of a node given available space on each axis. */
function measureNode(node: LayoutNode, availWidth: number, availHeight: number): Size {
  const s = node.style;
  const explicitW = s.width !== undefined ? clamp(s.width, s.minWidth, s.maxWidth) : undefined;
  const explicitH = s.height !== undefined ? clamp(s.height, s.minHeight, s.maxHeight) : undefined;
  if (explicitW !== undefined && explicitH !== undefined) {
    return { width: explicitW, height: explicitH };
  }

  const inFlow = node.children.filter((c) => c.style.position !== 'absolute');
  let contentW = 0;
  let contentH = 0;

  if (inFlow.length === 0 && node.measure !== undefined) {
    const availInnerW = (explicitW ?? availWidth) - s.padding.left - s.padding.right;
    const availInnerH = (explicitH ?? availHeight) - s.padding.top - s.padding.bottom;
    const m = node.measure(Math.max(0, availInnerW), Math.max(0, availInnerH));
    contentW = m.width;
    contentH = m.height;
  } else if (inFlow.length > 0) {
    const row = isRow(s.flexDirection);
    let mainSum = 0;
    let crossMax = 0;
    for (const c of inFlow) {
      const m = measureNode(c, availWidth, availHeight);
      const cs = c.style;
      const outerMain =
        (row ? m.width : m.height) +
        (row ? cs.margin.left + cs.margin.right : cs.margin.top + cs.margin.bottom);
      const outerCross =
        (row ? m.height : m.width) +
        (row ? cs.margin.top + cs.margin.bottom : cs.margin.left + cs.margin.right);
      mainSum += outerMain;
      crossMax = Math.max(crossMax, outerCross);
    }
    mainSum += s.gap * Math.max(0, inFlow.length - 1);
    contentW = row ? mainSum : crossMax;
    contentH = row ? crossMax : mainSum;
  }

  const width = explicitW ?? clamp(contentW + s.padding.left + s.padding.right, s.minWidth, s.maxWidth);
  const height =
    explicitH ?? clamp(contentH + s.padding.top + s.padding.bottom, s.minHeight, s.maxHeight);
  return { width, height };
}

/** Distribute main-axis free space across items (CSS Flexible Box §9.7). */
function resolveFlexibleLengths(items: FlexItem[], innerMain: number): void {
  if (items.length === 0) return;
  const sumHypo = items.reduce((sum, it) => sum + it.hypoMain + it.mainMargin, 0);
  const growing = sumHypo < innerMain;

  for (const it of items) {
    const factor = growing ? it.grow : it.shrink;
    if (
      factor === 0 ||
      (growing && it.baseSize > it.hypoMain) ||
      (!growing && it.baseSize < it.hypoMain)
    ) {
      it.mainSize = it.hypoMain;
      it.frozen = true;
    } else {
      it.mainSize = it.baseSize;
      it.frozen = false;
    }
  }

  // Iterate until every item is frozen or the free space is fully allocated.
  let guard = items.length + 1;
  while (items.some((it) => !it.frozen) && guard-- > 0) {
    const usedByFrozen = items.reduce(
      (sum, it) => sum + (it.frozen ? it.mainSize : it.baseSize) + it.mainMargin,
      0,
    );
    const remaining = innerMain - usedByFrozen;
    const unfrozen = items.filter((it) => !it.frozen);

    if (growing) {
      const sumGrow = unfrozen.reduce((sum, it) => sum + it.grow, 0);
      for (const it of unfrozen) {
        it.mainSize = sumGrow > 0 ? it.baseSize + remaining * (it.grow / sumGrow) : it.baseSize;
      }
    } else {
      const sumScaled = unfrozen.reduce((sum, it) => sum + it.shrink * it.baseSize, 0);
      for (const it of unfrozen) {
        const scaled = it.shrink * it.baseSize;
        it.mainSize = sumScaled > 0 ? it.baseSize + remaining * (scaled / sumScaled) : it.baseSize;
      }
    }

    let totalViolation = 0;
    const violations = new Map<FlexItem, number>();
    for (const it of unfrozen) {
      const unclamped = it.mainSize;
      const clamped = clamp(unclamped, it.minMain, it.maxMain);
      violations.set(it, clamped - unclamped);
      totalViolation += clamped - unclamped;
      it.mainSize = clamped;
    }

    if (totalViolation === 0) {
      for (const it of unfrozen) it.frozen = true;
    } else if (totalViolation > 0) {
      for (const it of unfrozen) if ((violations.get(it) ?? 0) > 0) it.frozen = true;
    } else {
      for (const it of unfrozen) if ((violations.get(it) ?? 0) < 0) it.frozen = true;
    }
  }
  // Any items still unfrozen after the guard keep their last main size.
  for (const it of items) it.frozen = true;
}

/** Lay out `node`'s children given the node's final border-box `width`/`height`. */
function layoutNode(node: LayoutNode, width: number, height: number): LayoutResult {
  const s = node.style;
  const contentW = Math.max(0, width - s.padding.left - s.padding.right);
  const contentH = Math.max(0, height - s.padding.top - s.padding.bottom);
  const row = isRow(s.flexDirection);
  const innerMain = row ? contentW : contentH;
  const innerCross = row ? contentH : contentW;

  const inFlow = node.children.filter((c) => c.style.position !== 'absolute');

  if (s.display === 'grid') {
    return layoutGrid(node, width, height, contentW, contentH, inFlow);
  }

  const items: FlexItem[] = inFlow.map((child) => {
    const cs = child.style;
    const mainMargin = row
      ? cs.margin.left + cs.margin.right
      : cs.margin.top + cs.margin.bottom;
    const crossMargin = row
      ? cs.margin.top + cs.margin.bottom
      : cs.margin.left + cs.margin.right;
    const minMain = row ? cs.minWidth : cs.minHeight;
    const maxMain = row ? cs.maxWidth : cs.maxHeight;
    const mainSizeProp = row ? cs.width : cs.height;
    let baseSize: number;
    if (cs.flexBasis !== undefined) baseSize = cs.flexBasis;
    else if (mainSizeProp !== undefined) baseSize = mainSizeProp;
    else {
      const m = measureNode(child, innerMain, innerCross);
      baseSize = row ? m.width : m.height;
    }
    const hypoMain = clamp(baseSize, minMain, maxMain);
    return {
      child,
      style: cs,
      mainMargin,
      crossMargin,
      minMain,
      maxMain,
      grow: cs.flexGrow,
      shrink: cs.flexShrink,
      baseSize,
      hypoMain,
      mainSize: hypoMain,
      frozen: false,
      crossSize: 0,
      align: 'flex-start',
    };
  });

  resolveFlexibleLengths(items, innerMain);

  for (const it of items) {
    const cs = it.style;
    const crossSizeProp = row ? cs.height : cs.width;
    const minCross = row ? cs.minHeight : cs.minWidth;
    const maxCross = row ? cs.maxHeight : cs.maxWidth;
    it.align = cs.alignSelf === 'auto' ? s.alignItems : cs.alignSelf;
    if (crossSizeProp !== undefined) {
      it.crossSize = clamp(crossSizeProp, minCross, maxCross);
    } else if (it.align === 'stretch') {
      it.crossSize = clamp(Math.max(0, innerCross - it.crossMargin), minCross, maxCross);
    } else {
      const m = measureNode(
        it.child,
        row ? it.mainSize : innerCross,
        row ? innerCross : it.mainSize,
      );
      it.crossSize = clamp(row ? m.height : m.width, minCross, maxCross);
    }
  }

  const totalMain =
    items.reduce((sum, it) => sum + it.mainSize + it.mainMargin, 0) +
    s.gap * Math.max(0, items.length - 1);
  const leftover = innerMain - totalMain;
  const n = items.length;
  let cursor = 0;
  let between = s.gap;
  switch (s.justifyContent) {
    case 'flex-end':
      cursor = leftover;
      break;
    case 'center':
      cursor = leftover / 2;
      break;
    case 'space-between':
      between = s.gap + (n > 1 ? Math.max(0, leftover) / (n - 1) : 0);
      break;
    case 'space-around': {
      const g = n > 0 ? Math.max(0, leftover) / n : 0;
      cursor = g / 2;
      between = s.gap + g;
      break;
    }
    case 'space-evenly': {
      const g = Math.max(0, leftover) / (n + 1);
      cursor = g;
      between = s.gap + g;
      break;
    }
    default:
      break;
  }

  const order = isReverse(s.flexDirection) ? [...items].reverse() : items;
  const results = new Map<LayoutNode, LayoutResult>();
  let mainPos = cursor;
  for (const it of order) {
    const cs = it.style;
    const marginMainStart = row ? cs.margin.left : cs.margin.top;
    const marginCrossStart = row ? cs.margin.top : cs.margin.left;
    const freeCross = innerCross - it.crossSize - it.crossMargin;
    let crossPos = 0;
    if (it.align === 'flex-end') crossPos = freeCross;
    else if (it.align === 'center') crossPos = freeCross / 2;

    const mainStart = mainPos + marginMainStart;
    const crossStart = crossPos + marginCrossStart;
    const childW = row ? it.mainSize : it.crossSize;
    const childH = row ? it.crossSize : it.mainSize;
    const childX = s.padding.left + (row ? mainStart : crossStart);
    const childY = s.padding.top + (row ? crossStart : mainStart);
    results.set(it.child, offsetResult(layoutNode(it.child, childW, childH), childX, childY));
    mainPos += it.mainSize + it.mainMargin + between;
  }

  for (const child of node.children) {
    if (child.style.position === 'absolute') {
      results.set(child, layoutAbsolute(child, contentW, contentH, s));
    }
  }

  const children = node.children.map((c) => results.get(c) as LayoutResult);
  return {
    rect: { x: 0, y: 0, width, height },
    contentWidth: contentW,
    contentHeight: contentH,
    children,
    ...(node.key !== undefined ? { key: node.key } : {}),
  };
}

/**
 * Resolve a grid item's size + offset along one axis within its cell block:
 * `stretch` fills the cell, `flex-start` / `center` / `flex-end` place the item
 * at its own size (a definite style size if given, else its intrinsic size) at
 * the start / middle / end of the cell. Size is clamped to the item's min/max.
 */
function placeInCell(
  cell: number,
  definite: number | undefined,
  intrinsic: number,
  mode: AlignItems,
  min: number,
  max: number | undefined,
): { size: number; offset: number } {
  const size =
    definite !== undefined
      ? definite
      : mode === 'stretch'
        ? clamp(Math.max(0, cell), min, max)
        : clamp(intrinsic, min, max);
  const offset = mode === 'center' ? (cell - size) / 2 : mode === 'flex-end' ? cell - size : 0;
  return { size, offset };
}

/**
 * Leading offset that positions a grid's track block (`used` pixels) within the
 * container's `available` content space per `justify-content` / `align-content`:
 * `center` centers it, `flex-end` pushes it to the far edge, everything else
 * (incl. the `space-*` modes) starts at 0 — track-level space distribution is a
 * later phase. Only bites when the tracks don't fill the container.
 */
function contentOffset(mode: JustifyContent, used: number, available: number): number {
  const leftover = Math.max(0, available - used);
  return mode === 'center' ? leftover / 2 : mode === 'flex-end' ? leftover : 0;
}

/**
 * Lay out a `display: grid` node's children into template cells (row-major),
 * each child aligned within its cell by `justify-items`/`justify-self` (inline /
 * horizontal axis) and `align-items`/`align-self` (block / vertical axis) —
 * `stretch` (the default) fills the cell. In-flow children past the last cell get
 * a zero-size result at the content origin (grid auto-rows / overflow are a later
 * phase); absolute children are positioned as usual. The `gap` applies between
 * both columns and rows.
 */
function layoutGrid(
  node: LayoutNode,
  width: number,
  height: number,
  contentW: number,
  contentH: number,
  inFlow: readonly LayoutNode[],
): LayoutResult {
  const s = node.style;
  const columns = parseGridTemplate(s.gridTemplateColumns);
  const rows = parseGridTemplate(s.gridTemplateRows);
  const gridItems = inFlow.map((c) => ({
    colSpan: c.style.gridColumnSpan,
    rowSpan: c.style.gridRowSpan,
    colStart: c.style.gridColumnStart,
    rowStart: c.style.gridRowStart,
  }));

  // Generate implicit rows (CSS grid-auto-rows) so items past the explicit rows
  // flow into fixed-height rows instead of collapsing to zero size.
  if (s.gridAutoRows > 0 && columns.length > 0) {
    const needed = gridRowCount(columns.length, gridItems);
    while (rows.length < needed) rows.push({ kind: 'px', value: s.gridAutoRows });
  }

  const grid = computeGridLayout(
    { columns, rows, columnGap: s.gap, rowGap: s.gap },
    { width: contentW, height: contentH },
  );

  // Auto-place each in-flow child (honoring its column/row span) into the grid.
  const placed = placeGridItems(
    { columnSizes: grid.columnSizes, rowSizes: grid.rowSizes, columnGap: s.gap, rowGap: s.gap },
    gridItems,
  );

  // Distribute the whole track block within the content box when it doesn't fill
  // it (justify-content = column axis, align-content = row axis).
  const usedW = grid.columnSizes.reduce((a, b) => a + b, 0) + s.gap * Math.max(0, grid.columnSizes.length - 1);
  const usedH = grid.rowSizes.reduce((a, b) => a + b, 0) + s.gap * Math.max(0, grid.rowSizes.length - 1);
  const contentOffsetX = contentOffset(s.justifyContent, usedW, contentW);
  const contentOffsetY = contentOffset(s.alignContent, usedH, contentH);

  const results = new Map<LayoutNode, LayoutResult>();
  inFlow.forEach((child, i) => {
    const rect = placed[i]!;
    const cs = child.style;
    // justify* = inline (horizontal) axis; align* = block (vertical) axis.
    const justify = cs.justifySelf === 'auto' ? s.justifyItems : cs.justifySelf;
    const align = cs.alignSelf === 'auto' ? s.alignItems : cs.alignSelf;
    const defW = cs.width !== undefined ? clamp(cs.width, cs.minWidth, cs.maxWidth) : undefined;
    const defH = cs.height !== undefined ? clamp(cs.height, cs.minHeight, cs.maxHeight) : undefined;
    // Only measure intrinsic size when a non-stretch axis lacks a definite size.
    const needMeasure =
      (defW === undefined && justify !== 'stretch') || (defH === undefined && align !== 'stretch');
    const m = needMeasure ? measureNode(child, rect.width, rect.height) : { width: 0, height: 0 };
    const col = placeInCell(rect.width, defW, m.width, justify, cs.minWidth, cs.maxWidth);
    const rowAxis = placeInCell(rect.height, defH, m.height, align, cs.minHeight, cs.maxHeight);
    results.set(
      child,
      offsetResult(
        layoutNode(child, col.size, rowAxis.size),
        s.padding.left + contentOffsetX + rect.x + col.offset,
        s.padding.top + contentOffsetY + rect.y + rowAxis.offset,
      ),
    );
  });

  for (const child of node.children) {
    if (child.style.position === 'absolute') {
      results.set(child, layoutAbsolute(child, contentW, contentH, s));
    }
  }

  const children = node.children.map((c) => results.get(c) as LayoutResult);
  return {
    rect: { x: 0, y: 0, width, height },
    contentWidth: contentW,
    contentHeight: contentH,
    children,
    ...(node.key !== undefined ? { key: node.key } : {}),
  };
}

/** Position an out-of-flow child by its insets within the parent's content box. */
function layoutAbsolute(
  child: LayoutNode,
  contentW: number,
  contentH: number,
  parent: UiStyle,
): LayoutResult {
  const cs = child.style;
  const m = measureNode(child, contentW, contentH);
  let w = cs.width !== undefined ? clamp(cs.width, cs.minWidth, cs.maxWidth) : m.width;
  let h = cs.height !== undefined ? clamp(cs.height, cs.minHeight, cs.maxHeight) : m.height;
  if (cs.width === undefined && cs.left !== undefined && cs.right !== undefined) {
    w = clamp(Math.max(0, contentW - cs.left - cs.right), cs.minWidth, cs.maxWidth);
  }
  if (cs.height === undefined && cs.top !== undefined && cs.bottom !== undefined) {
    h = clamp(Math.max(0, contentH - cs.top - cs.bottom), cs.minHeight, cs.maxHeight);
  }
  let x = parent.padding.left;
  let y = parent.padding.top;
  if (cs.left !== undefined) x = parent.padding.left + cs.left;
  else if (cs.right !== undefined) x = parent.padding.left + contentW - cs.right - w;
  if (cs.top !== undefined) y = parent.padding.top + cs.top;
  else if (cs.bottom !== undefined) y = parent.padding.top + contentH - cs.bottom - h;
  return offsetResult(layoutNode(child, w, h), x, y);
}

/** Shift only the top-level rect of a result (its children stay relative to it). */
function offsetResult(result: LayoutResult, dx: number, dy: number): LayoutResult {
  return { ...result, rect: { ...result.rect, x: result.rect.x + dx, y: result.rect.y + dy } };
}
