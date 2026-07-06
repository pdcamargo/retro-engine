import type { Entity, Query as QueryHandle, World } from '@retro-engine/ecs';
import type { App, PluginObject } from '@retro-engine/engine';
import { Children, Parent, Query, Res } from '@retro-engine/engine';
import { FieldType, type Schema, t } from '@retro-engine/reflect';

import { FlexLayoutEngine } from './flex-layout';
import type { LayoutEngine, LayoutNode, LayoutResult } from './layout-engine';
import { ComputedLayout, UiNode } from './ui-node';
import type { UiStyle } from './ui-style';

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
  }) as unknown as FieldType<UiStyle>,
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

    app.registerComponent(UiNode, uiNodeSchema, { name: 'UiNode', make: () => new UiNode() });

    app.addSystem(
      'postUpdate',
      [Query([UiNode]), Res(UiViewport), Res(UiLayout)],
      (nodes, viewport, layout) => {
        runUiLayout(
          app.world,
          nodes as unknown as UiNodeQuery,
          viewport as UiViewport,
          (layout as UiLayout).engine,
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
): void => {
  const uiSet = new Set<Entity>();
  for (const row of nodes.entries()) uiSet.add(row[0] as Entity);
  if (uiSet.size === 0) return;

  for (const entity of uiSet) {
    const parent = world.getComponent(entity, Parent);
    if (parent !== undefined && uiSet.has(parent.entity)) continue; // not a root
    const tree = buildLayoutNode(world, entity, uiSet);
    const result = engine.compute(tree, { width: viewport.width, height: viewport.height });
    writeLayout(world, result, 0, 0);
  }
};

/** Build a {@link LayoutNode} from an entity's `UiNode` + its `UiNode` children. */
const buildLayoutNode = (world: World, entity: Entity, uiSet: Set<Entity>): LayoutNode => {
  const node = world.getComponent(entity, UiNode);
  const children = world.getComponent(entity, Children);
  const kids: LayoutNode[] = [];
  if (children !== undefined) {
    for (const child of children.entities) {
      if (uiSet.has(child)) kids.push(buildLayoutNode(world, child, uiSet));
    }
  }
  return { style: node!.style, children: kids, key: entity };
};

/** Write a result subtree into each entity's `ComputedLayout` (absolute coords). */
const writeLayout = (world: World, result: LayoutResult, originX: number, originY: number): void => {
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
    world.markChanged(entity, ComputedLayout);
  }
  for (const child of result.children) writeLayout(world, child, absX, absY);
};
