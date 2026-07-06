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
  /** The node's resolved layout style. Mutate and the next layout pass reflows. */
  style: UiStyle;

  constructor(init: UiStyleInit = {}) {
    this.style = makeStyle(init);
  }

  static readonly requires = [ComputedLayout];
}
