import type { Entity } from '@retro-engine/ecs';
import type { App, PluginObject } from '@retro-engine/engine';
import { MessageReader, MessageWriter, Query, Res, ResMut } from '@retro-engine/engine';

import { UiClicked } from '../interaction/ui-clicked';
import { ComputedLayout } from '../ui-node';

import { type FocusNode, spatialNavigate, tabNavigate } from './focus-nav';
import { shouldActivateFocused, UiActivate } from './ui-activate';
import { Focusable, UiFocus, UiNavigate } from './ui-focus';

/**
 * Tracks UI focus and moves it on {@link UiNavigate} requests. Add it, spawn some
 * {@link Focusable} nodes, and emit `UiNavigate` from your input mapping; the
 * focused entity is exposed on the {@link UiFocus} resource.
 *
 * Sequential moves (`'next'`/`'prev'`) walk tab order (a node's layout paint
 * order); directional moves (`'up'`/`'down'`/`'left'`/`'right'`) pick the nearest
 * focusable neighbour. Focus that points at a node no longer focusable (despawned
 * or un-marked) is cleared. Runs in `preUpdate` after the input drain.
 */
export class UiFocusPlugin implements PluginObject {
  name(): string {
    return 'UiFocusPlugin';
  }

  build(app: App): void {
    if (app.getResource(UiFocus) === undefined) app.insertResource(new UiFocus());
    app.addMessage(UiNavigate);
    app.addMessage(UiActivate);
    // Idempotent if UiInteractionPlugin already registered it; ensures the
    // activation system can always write a UiClicked even without that plugin.
    app.addMessage(UiClicked);
    app.registerComponent(Focusable, {}, { name: 'Focusable', make: () => new Focusable() });

    app.addSystem(
      'preUpdate',
      [MessageReader(UiNavigate), ResMut(UiFocus), Query([ComputedLayout, Focusable])],
      (navs, focus, nodesQuery) => {
        const f = focus as UiFocus;
        // Snapshot focusable nodes with their paint order, then sort into tab
        // order (paint order is a stable proxy: parents before children, siblings
        // in registration order).
        const withOrder: { node: FocusNode; order: number }[] = [];
        for (const row of (nodesQuery as { entries(): Iterable<readonly unknown[]> }).entries()) {
          const layout = row[1] as ComputedLayout;
          withOrder.push({
            node: {
              entity: row[0] as Entity,
              x: layout.x,
              y: layout.y,
              width: layout.width,
              height: layout.height,
            },
            order: layout.order,
          });
        }
        withOrder.sort((a, b) => a.order - b.order);
        const nodes = withOrder.map((w) => w.node);

        // Drop focus pointing at a node that is no longer focusable.
        if (f.current !== null && !nodes.some((n) => n.entity === f.current)) f.current = null;

        for (const nav of navs as Iterable<UiNavigate>) {
          const next =
            nav.direction === 'next' || nav.direction === 'prev'
              ? tabNavigate(nodes, f.current, nav.direction === 'prev')
              : spatialNavigate(nodes, f.current, nav.direction);
          if (next !== null) f.current = next;
        }
      },
      { label: 'ui-focus', after: ['input'] },
    );

    // Activate the focused node: turn a UiActivate into a UiClicked on the focused
    // entity, so keyboard/gamepad activation drives the same click path as the
    // pointer. Runs after focus moves this frame, before click consumers (toggle).
    app.addSystem(
      'preUpdate',
      [MessageReader(UiActivate), Res(UiFocus), MessageWriter(UiClicked)],
      (activates, focus, clicked) => {
        const activated = [...(activates as Iterable<UiActivate>)].length > 0;
        const target = shouldActivateFocused(activated, (focus as UiFocus).current);
        if (target !== null) (clicked as { write(m: UiClicked): void }).write(new UiClicked(target));
      },
      { label: 'ui-activate', after: ['ui-focus'], before: ['ui-toggle'] },
    );
  }
}
