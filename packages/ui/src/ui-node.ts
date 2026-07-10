import type { Vec4 } from '@retro-engine/math';

import { makeStyle, type UiStyle, type UiStyleInit } from './ui-style';

/**
 * The computed geometry of a UI node, written each frame by the layout system.
 * `x`/`y` are **absolute** (screen-space) logical pixels — ancestor offsets are
 * already accumulated — so a renderer can place the node directly. Content sizes
 * are the border box minus padding.
 *
 * Derived state (recomputed from {@link UiNode} + the hierarchy every layout
 * pass), therefore **deliberately not serialized** — it carries no authored
 * information a saved scene needs.
 */
export class ComputedLayout {
  constructor(
    public x = 0,
    public y = 0,
    public width = 0,
    public height = 0,
    public contentWidth = 0,
    public contentHeight = 0,
    /**
     * Depth-first paint order stamped by the layout pass: a parent is always
     * lower than its children, so drawing ascending yields correct
     * back-to-front nesting (children paint over their parent's background).
     */
    public order = 0,
  ) {}
}

/**
 * A node in the retained UI tree: its authored layout {@link UiStyle}. UI nesting
 * reuses the engine's `Parent`/`Children` hierarchy — a `UiNode` whose parent is
 * also a `UiNode` is laid out inside it; one whose parent is not (or has none) is
 * a UI root sized against the viewport.
 *
 * Auto-attaches {@link ComputedLayout} via required components, so the layout
 * system always has somewhere to write results.
 *
 * @example
 * ```ts
 * cmd.spawn(new UiNode({ flexDirection: 'column', padding: 8, gap: 4 }))
 *   .withChildren((p) => {
 *     p.spawn(new UiNode({ height: 24 }));
 *     p.spawn(new UiNode({ flexGrow: 1 }));
 *   });
 * ```
 */
export class UiNode {
  #style: UiStyle;

  constructor(init: UiStyleInit = {}) {
    this.#style = makeStyle(init);
  }

  /** The node's resolved layout style. Mutate a field and the next layout pass reflows. */
  get style(): UiStyle {
    return this.#style;
  }

  /**
   * Assigning a style normalizes it through {@link makeStyle}, so a partial style
   * — e.g. one produced by scene/reflection decode or built by hand — is filled
   * out with every default. The layout engine always sees a fully-specified
   * style, so a node authored with only a few fields (say `width` + a
   * `backgroundColor`) still lays out and renders.
   */
  set style(value: UiStyleInit) {
    this.#style = makeStyle(value);
  }

  static readonly requires = [ComputedLayout];
}

/**
 * Set a node's background color at runtime. The resolved {@link UiStyle} is
 * otherwise read-only; this is the supported way to recolor a node each frame
 * (e.g. button hover/press feedback) without rebuilding the whole style.
 */
export const setUiBackground = (node: UiNode, color: Vec4 | undefined): void => {
  (node.style as { backgroundColor: Vec4 | undefined }).backgroundColor = color;
};
