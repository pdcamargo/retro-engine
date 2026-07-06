import { describe, expect, it } from 'bun:test';

import type { Entity } from '@retro-engine/ecs';
import { World } from '@retro-engine/ecs';
import type { Font, Fonts, Handle } from '@retro-engine/engine';
import { Children, Parent } from '@retro-engine/engine';
import {
  type DecodeEnv,
  decodeComponent,
  type EncodeEnv,
  encodeComponent,
  TypeRegistry,
} from '@retro-engine/reflect';

import { FlexLayoutEngine } from './flex-layout';
import { ComputedLayout, UiNode } from './ui-node';
import { runUiLayout, uiNodeSchema, UiViewport } from './ui-plugin';
import { UiText } from './ui-text';

const engine = new FlexLayoutEngine();
const layout = (world: World, viewport = new UiViewport(1280, 720)) =>
  runUiLayout(world, world.query([UiNode]), viewport, engine);
const cl = (world: World, e: Entity) => world.getComponent(e, ComputedLayout)!;

describe('runUiLayout (ECS layout system)', () => {
  it('auto-attaches ComputedLayout to a UiNode via required components', () => {
    const world = new World();
    const e = world.spawn(new UiNode({ width: 10 }));
    expect(world.getComponent(e, ComputedLayout)).toBeInstanceOf(ComputedLayout);
  });

  it('computes absolute geometry for a flex-row hierarchy', () => {
    const world = new World();
    const root = world.spawn(new UiNode({ width: 200, height: 100, flexDirection: 'row' }));
    const a = world.spawn(new UiNode({ width: 50 }), new Parent(root));
    const b = world.spawn(new UiNode({ flexGrow: 1 }), new Parent(root));
    world.entity(root).insert(new Children([a, b]));

    layout(world);

    const r = cl(world, root);
    expect([r.x, r.y, r.width, r.height]).toEqual([0, 0, 200, 100]);
    const al = cl(world, a);
    expect([al.x, al.width, al.height]).toEqual([0, 50, 100]);
    const bl = cl(world, b);
    expect([bl.x, bl.width]).toEqual([50, 150]); // grows into the remaining 150
  });

  it('sizes an auto root to the viewport', () => {
    const world = new World();
    const root = world.spawn(new UiNode({}));
    layout(world, new UiViewport(800, 600));
    const r = cl(world, root);
    expect([r.width, r.height]).toEqual([800, 600]);
  });

  it('accumulates ancestor offsets into absolute positions', () => {
    const world = new World();
    const root = world.spawn(new UiNode({ width: 200, height: 100, padding: 10 }));
    const mid = world.spawn(
      new UiNode({ flexGrow: 1, padding: 5, flexDirection: 'column' }),
      new Parent(root),
    );
    world.entity(root).insert(new Children([mid]));
    const leaf = world.spawn(new UiNode({ height: 20 }), new Parent(mid));
    world.entity(mid).insert(new Children([leaf]));

    layout(world);

    // mid sits at the root's padding (10,10).
    const m = cl(world, mid);
    expect([m.x, m.y]).toEqual([10, 10]);
    // leaf sits at mid's border-box origin + mid's padding: (10+5, 10+5).
    const l = cl(world, leaf);
    expect([l.x, l.y]).toEqual([15, 15]);
  });

  it('treats a UiNode under a non-UI parent as a root', () => {
    class Marker {}
    const world = new World();
    const host = world.spawn(new Marker());
    const root = world.spawn(new UiNode({ width: 120, height: 60 }), new Parent(host));

    layout(world);

    const r = cl(world, root);
    expect([r.x, r.y, r.width, r.height]).toEqual([0, 0, 120, 60]);
  });

  it('does nothing when there are no UI nodes', () => {
    const world = new World();
    expect(() => layout(world)).not.toThrow();
  });

  it('sizes a UiText leaf to its measured text via the font store', () => {
    // A font store + font that report a fixed 123×45 block for any text.
    const fontHandle = {} as Handle<Font>;
    const fakeFont = { measure: () => ({ width: 123, height: 45, lineCount: 1 }) } as unknown as Font;
    const fakeFonts = { get: () => fakeFont } as unknown as Fonts;

    const world = new World();
    // flex-start on the cross axis so the leaf's height is its measured height,
    // not stretched to the row.
    const root = world.spawn(
      new UiNode({ width: 400, height: 100, flexDirection: 'row', alignItems: 'flex-start' }),
    );
    const child = world.spawn(new UiNode({}), new UiText({ text: 'hi', font: fontHandle }), new Parent(root));
    world.entity(root).insert(new Children([child]));

    runUiLayout(world, world.query([UiNode]), new UiViewport(1280, 720), engine, fakeFonts);

    const c = cl(world, child);
    expect([c.width, c.height]).toEqual([123, 45]);
  });

  it('leaves a UiText node style-sized when no font store is provided', () => {
    const fontHandle = {} as Handle<Font>;
    const world = new World();
    const root = world.spawn(
      new UiNode({ width: 400, height: 100, flexDirection: 'row', alignItems: 'flex-start' }),
    );
    const child = world.spawn(
      new UiNode({ width: 60, height: 20 }),
      new UiText({ text: 'hi', font: fontHandle }),
      new Parent(root),
    );
    world.entity(root).insert(new Children([child]));

    // No fonts arg → no measure func attached; the node keeps its explicit size.
    layout(world);

    const c = cl(world, child);
    expect([c.width, c.height]).toEqual([60, 20]);
  });
});

describe('UiNode reflection', () => {
  const makeReg = () => {
    const reg = new TypeRegistry();
    const entry = reg.registerComponent(UiNode, uiNodeSchema, {
      name: 'UiNode',
      make: () => new UiNode(),
    });
    return { reg, entry };
  };
  const enc = (reg: TypeRegistry): EncodeEnv => ({
    registry: reg,
    entityId: (e) => e as unknown as number,
    handleRef: () => undefined,
  });
  const dec = (reg: TypeRegistry): DecodeEnv => ({
    registry: reg,
    entity: (id) => id as unknown as Entity,
    resolveHandle: () => {
      throw new Error('UiNode has no handle fields');
    },
  });

  it('round-trips every authored style field through serialization', () => {
    const { reg, entry } = makeReg();
    const node = new UiNode({
      flexDirection: 'column',
      justifyContent: 'space-between',
      alignItems: 'center',
      alignSelf: 'flex-end',
      flexGrow: 2,
      flexShrink: 0,
      width: 120,
      maxWidth: 300,
      minHeight: 8,
      padding: 8,
      margin: { left: 4, top: 2 },
      gap: 4,
      position: 'absolute',
      left: 10,
      bottom: 6,
    });

    const back = decodeComponent(entry, encodeComponent(entry, node, enc(reg)), dec(reg)) as UiNode;

    expect(back).toBeInstanceOf(UiNode);
    expect(back.style.flexDirection).toBe('column');
    expect(back.style.justifyContent).toBe('space-between');
    expect(back.style.alignItems).toBe('center');
    expect(back.style.alignSelf).toBe('flex-end');
    expect(back.style.flexGrow).toBe(2);
    expect(back.style.flexShrink).toBe(0);
    expect(back.style.width).toBe(120);
    expect(back.style.maxWidth).toBe(300);
    expect(back.style.minHeight).toBe(8);
    expect(back.style.padding).toEqual({ left: 8, right: 8, top: 8, bottom: 8 });
    expect(back.style.margin.left).toBe(4);
    expect(back.style.margin.top).toBe(2);
    expect(back.style.gap).toBe(4);
    expect(back.style.position).toBe('absolute');
    expect(back.style.left).toBe(10);
    expect(back.style.bottom).toBe(6);
    // Unset (auto) dimensions round-trip as undefined.
    expect(back.style.height).toBeUndefined();
    expect(back.style.maxHeight).toBeUndefined();
  });

  it('registers under the stable name "UiNode"', () => {
    const { reg } = makeReg();
    expect(reg.get('UiNode')?.ctor).toBe(UiNode);
  });
});
