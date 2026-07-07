import type { Entity, Query as QueryHandle, World } from '@retro-engine/ecs';
import type { App, Font, Fonts, Image, PluginObject } from '@retro-engine/engine';
import { ASSET_TYPE, Children, Fonts as FontsResource, Parent, Query, Res } from '@retro-engine/engine';
import { FieldType, type Schema, t } from '@retro-engine/reflect';

import { UiFocus } from './focus/ui-focus';
import { FlexLayoutEngine } from './flex-layout';
import type { LayoutEngine, LayoutNode, LayoutResult } from './layout-engine';
import { resolveUiStyles, UiClass, uiClassSchema, UiStyleSheet, UiTheme } from './rss-style';
import { makeTextMeasure } from './text-measure';
import { UiImage } from './ui-image';
import { ComputedLayout, UiNode } from './ui-node';
import type { UiStyle } from './ui-style';
import { UiText } from './ui-text';

/**
 * Available space for UI roots, in logical pixels. A UI root with no explicit
 * size fills this. The studio / game updates it from the canvas / render target;
 * it defaults to a common 720p logical size.
 */
export class UiViewport {
  constructor(
    public width = 1280,
    public height = 720,
  ) {}
}

/**
 * Holds the {@link LayoutEngine} the UI layout system runs. Swap the engine
 * (e.g. a future grid or WASM engine) by replacing this resource before the
 * first frame; defaults to {@link FlexLayoutEngine}.
 */
export class UiLayout {
  constructor(public engine: LayoutEngine = new FlexLayoutEngine()) {}
}

const EDGES_STRUCT = t.struct({
  left: t.number,
  right: t.number,
  top: t.number,
  bottom: t.number,
});

/**
 * Reflection schema for {@link UiNode}: the authored {@link UiStyle} as a nested
 * struct (`ComputedLayout` is derived and not registered). Exported so it can be
 * registered against a bare `TypeRegistry` in tests without an `App`.
 *
 * Every field is authored layout state, so all persist. `undefined` dimensions
 * (auto) and `undefined` max-sizes (no limit) are omitted on encode and restored
 * to the constructor default on load.
 */
export const uiNodeSchema: Schema<UiNode> = {
  style: t.struct({
    display: t.enum('flex', 'grid'),
    gridTemplateColumns: t.string,
    gridTemplateRows: t.string,
    gridColumnSpan: t.number,
    gridRowSpan: t.number,
    gridAutoRows: t.number,
    flexDirection: t.enum('row', 'row-reverse', 'column', 'column-reverse'),
    justifyContent: t.enum(
      'flex-start',
      'flex-end',
      'center',
      'space-between',
      'space-around',
      'space-evenly',
    ),
    alignItems: t.enum('flex-start', 'flex-end', 'center', 'stretch'),
    alignSelf: t.enum('auto', 'flex-start', 'flex-end', 'center', 'stretch'),
    justifyItems: t.enum('flex-start', 'flex-end', 'center', 'stretch'),
    justifySelf: t.enum('auto', 'flex-start', 'flex-end', 'center', 'stretch'),
    flexGrow: t.number,
    flexShrink: t.number,
    flexBasis: t.number.optional(),
    width: t.number.optional(),
    height: t.number.optional(),
    minWidth: t.number,
    maxWidth: t.number.optional(),
    minHeight: t.number,
    maxHeight: t.number.optional(),
    padding: EDGES_STRUCT,
    margin: EDGES_STRUCT,
    gap: t.number,
    position: t.enum('relative', 'absolute'),
    left: t.number.optional(),
    right: t.number.optional(),
    top: t.number.optional(),
    bottom: t.number.optional(),
    backgroundColor: t.vec4.optional(),
    borderWidth: EDGES_STRUCT,
    borderColor: t.vec4.optional(),
  }) as unknown as FieldType<UiStyle>,
};

/**
 * Reflection schema for {@link UiText}: the authored string plus the font and
 * metrics that size it. `font` is optional (a text node with no font is not
 * intrinsically sized); `lineHeight` is optional (font default). Visual styling
 * is applied by the render layer and not carried here, so nothing else persists.
 */
export const uiTextSchema: Schema<UiText> = {
  text: t.string,
  font: t.handle<Font>(ASSET_TYPE.font).optional(),
  fontSize: t.number,
  letterSpacing: t.number,
  lineHeight: t.number.optional(),
  color: t.vec4,
};

/**
 * Reflection schema for {@link UiImage}: the source image handle (optional — a
 * node may carry the component before its image resolves), the tint, and the
 * source UV sub-rect. All authored, so all persist.
 */
export const uiImageSchema: Schema<UiImage> = {
  image: t.handle<Image>(ASSET_TYPE.image).optional(),
  tint: t.vec4,
  uv: t.array(t.number) as unknown as FieldType<[number, number, number, number]>,
};

type UiNodeQuery = QueryHandle<readonly [typeof UiNode]>;

/**
 * Engine plugin for the in-game UI layout pass. Registers {@link UiNode}'s
 * reflection schema (`ComputedLayout` is derived, not registered), inserts the
 * {@link UiViewport} + {@link UiLayout} resources, and runs a `postUpdate`
 * `'ui-layout'` system that mirrors the `UiNode` hierarchy into a
 * {@link LayoutNode} tree, computes it, and writes absolute geometry back into
 * each entity's `ComputedLayout`.
 *
 * Rendering (drawing the computed boxes + text through the 2D pipeline) is a
 * separate plugin/phase; this one only computes layout.
 */
export class UiPlugin implements PluginObject {
  name(): string {
    return 'UiPlugin';
  }

  build(app: App): void {
    if (app.getResource(UiViewport) === undefined) app.insertResource(new UiViewport());
    if (app.getResource(UiLayout) === undefined) app.insertResource(new UiLayout());
    if (app.getResource(UiStyleSheet) === undefined) app.insertResource(new UiStyleSheet());
    if (app.getResource(UiTheme) === undefined) app.insertResource(new UiTheme());

    app.registerComponent(UiNode, uiNodeSchema, { name: 'UiNode', make: () => new UiNode() });
    app.registerComponent(UiText, uiTextSchema, { name: 'UiText', make: () => new UiText() });
    app.registerComponent(UiImage, uiImageSchema, { name: 'UiImage', make: () => new UiImage() });
    app.registerComponent(UiClass, uiClassSchema, { name: 'UiClass', make: () => new UiClass() });

    // Resolve `.rss` styles before layout so a node's stylesheet-driven size /
    // paint (and any pseudo-class state change) is in place for the same frame.
    app.addSystem(
      'postUpdate',
      [Query([UiNode]), Res(UiStyleSheet), Res(UiTheme)],
      (nodes, sheet, theme) => {
        // Soft dependency on UiFocusPlugin: drive `:focus` styling when present,
        // no-op (null) otherwise so the style system runs without focus wired up.
        const focused = app.getResource(UiFocus)?.current ?? null;
        resolveUiStyles(
          app.world,
          nodes as unknown as Parameters<typeof resolveUiStyles>[1],
          sheet as UiStyleSheet,
          theme as UiTheme,
          focused,
        );
      },
      { label: 'ui-style' },
    );

    app.addSystem(
      'postUpdate',
      [Query([UiNode]), Res(UiViewport), Res(UiLayout)],
      (nodes, viewport, layout) => {
        runUiLayout(
          app.world,
          nodes as unknown as UiNodeQuery,
          viewport as UiViewport,
          (layout as UiLayout).engine,
          // Text sizing needs the font store; absent (no TextPlugin) → nodes size by style alone.
          app.getResource(FontsResource),
        );
      },
      { label: 'ui-layout' },
    );
  }
}

/**
 * Compute layout for every UI root in the world and write results back. A UI
 * root is a `UiNode` whose parent is not a `UiNode` (or has none); each is laid
 * out independently against the viewport.
 */
export const runUiLayout = (
  world: World,
  nodes: UiNodeQuery,
  viewport: UiViewport,
  engine: LayoutEngine,
  fonts?: Fonts,
): void => {
  const uiSet = new Set<Entity>();
  for (const row of nodes.entries()) uiSet.add(row[0] as Entity);
  if (uiSet.size === 0) return;

  const order = { n: 0 };
  for (const entity of uiSet) {
    const parent = world.getComponent(entity, Parent);
    if (parent !== undefined && uiSet.has(parent.entity)) continue; // not a root
    const tree = buildLayoutNode(world, entity, uiSet, fonts);
    const result = engine.compute(tree, { width: viewport.width, height: viewport.height });
    writeLayout(world, result, 0, 0, order);
  }
};

/**
 * Build a {@link LayoutNode} from an entity's `UiNode` + its `UiNode` children.
 * A node carrying a {@link UiText} (with `fonts` available) also gets an
 * intrinsic text {@link MeasureFunc}, which the flex engine uses when the node
 * has no in-flow children.
 */
const buildLayoutNode = (
  world: World,
  entity: Entity,
  uiSet: Set<Entity>,
  fonts: Fonts | undefined,
): LayoutNode => {
  const node = world.getComponent(entity, UiNode);
  const children = world.getComponent(entity, Children);
  const kids: LayoutNode[] = [];
  if (children !== undefined) {
    for (const child of children.entities) {
      if (uiSet.has(child)) kids.push(buildLayoutNode(world, child, uiSet, fonts));
    }
  }
  const uiText = fonts !== undefined ? world.getComponent(entity, UiText) : undefined;
  const measure = uiText !== undefined ? makeTextMeasure(uiText, fonts!) : undefined;
  return {
    style: node!.style,
    children: kids,
    key: entity,
    ...(measure !== undefined ? { measure } : {}),
  };
};

/**
 * Write a result subtree into each entity's `ComputedLayout` (absolute coords),
 * stamping a depth-first `order` (parent before its children) so the render
 * layer can paint back-to-front by nesting.
 */
const writeLayout = (
  world: World,
  result: LayoutResult,
  originX: number,
  originY: number,
  order: { n: number },
): void => {
  const entity = result.key as Entity;
  const absX = originX + result.rect.x;
  const absY = originY + result.rect.y;
  const layout = world.getComponent(entity, ComputedLayout);
  if (layout !== undefined) {
    layout.x = absX;
    layout.y = absY;
    layout.width = result.rect.width;
    layout.height = result.rect.height;
    layout.contentWidth = result.contentWidth;
    layout.contentHeight = result.contentHeight;
    layout.order = order.n;
    world.markChanged(entity, ComputedLayout);
  }
  order.n += 1;
  for (const child of result.children) writeLayout(world, child, absX, absY, order);
};
