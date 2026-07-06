import type { Entity } from '@retro-engine/ecs';
import type { App, PluginObject } from '@retro-engine/engine';
import { MessageWriter, Query, ResMut } from '@retro-engine/engine';
import { CursorPosition, MouseButtonInput } from '@retro-engine/input';

import { ComputedLayout } from '../ui-node';

import { type InteractionNode, updateUiInteraction, UiPointer } from './picking';
import { UiClicked } from './ui-clicked';
import { Interactable, UiInteraction } from './ui-interaction';

/**
 * Drives UI pointer interaction: hit-tests {@link Interactable} nodes against the
 * cursor each frame, maintains their {@link UiInteraction} state, and emits
 * {@link UiClicked} on a completed click. Runs in `preUpdate` after the input
 * update, so game systems in `update` see fresh interaction state and clicks.
 *
 * Requires an `InputPlugin` for `CursorPosition` / `MouseButtonInput`; without
 * one (headless) the system is a no-op. Add alongside {@link UiPlugin}.
 */
export class UiInteractionPlugin implements PluginObject {
  name(): string {
    return 'UiInteractionPlugin';
  }

  build(app: App): void {
    app.addMessage(UiClicked);
    app.registerComponent(Interactable, {}, { name: 'Interactable', make: () => new Interactable() });
    if (app.getResource(UiPointer) === undefined) app.insertResource(new UiPointer());

    app.addSystem(
      'preUpdate',
      [Query([ComputedLayout, UiInteraction]), ResMut(UiPointer), MessageWriter(UiClicked)],
      (nodesQuery, pointer, clicked) => {
        const cursor = app.getResource(CursorPosition);
        const buttons = app.getResource(MouseButtonInput);
        if (cursor === undefined || buttons === undefined) return;

        const nodes: InteractionNode[] = [];
        for (const row of (nodesQuery as { entries(): Iterable<readonly unknown[]> }).entries()) {
          nodes.push({
            entity: row[0] as Entity,
            layout: row[1] as ComputedLayout,
            ui: row[2] as UiInteraction,
          });
        }

        updateUiInteraction(
          nodes,
          cursor,
          buttons,
          pointer as UiPointer,
          (entity) => (clicked as { write(m: UiClicked): void }).write(new UiClicked(entity)),
          (entity) => app.world.markChanged(entity, UiInteraction),
        );
      },
      { label: 'ui-interaction', after: ['input'] },
    );
  }
}
