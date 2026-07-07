import type { Entity } from '@retro-engine/ecs';
import type { App, PluginObject } from '@retro-engine/engine';
import { MessageReader, MessageWriter, Query, ResMut } from '@retro-engine/engine';
import { t } from '@retro-engine/reflect';
import { CursorPosition, MouseButtonInput } from '@retro-engine/input';

import { ComputedLayout, setUiBackground, UiNode } from '../ui-node';

import { type InteractionNode, updateUiInteraction, UiPointer } from './picking';
import { Disabled, UiButton } from './ui-button';
import { UiClicked } from './ui-clicked';
import { Interactable, UiInteraction } from './ui-interaction';
import { applyToggleClicks, UiToggle, UiToggled } from './ui-toggle';

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
    app.registerComponent(Disabled, {}, { name: 'Disabled', make: () => new Disabled() });
    app.registerComponent(
      UiButton,
      { normal: t.vec4, hovered: t.vec4, pressed: t.vec4, disabled: t.vec4 },
      { name: 'UiButton', make: () => new UiButton() },
    );
    app.addMessage(UiToggled);
    app.registerComponent(
      UiToggle,
      { checked: t.boolean, on: t.vec4, off: t.vec4, disabled: t.vec4 },
      { name: 'UiToggle', make: () => new UiToggle() },
    );
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
          const entity = row[0] as Entity;
          nodes.push({
            entity,
            layout: row[1] as ComputedLayout,
            ui: row[2] as UiInteraction,
            disabled: app.world.getComponent(entity, Disabled) !== undefined,
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

    // Drive each UiButton's background from its interaction state (built-in).
    app.addSystem(
      'preUpdate',
      [Query([UiNode, UiInteraction, UiButton])],
      (buttonsQuery) => {
        for (const row of (buttonsQuery as { entries(): Iterable<readonly unknown[]> }).entries()) {
          const entity = row[0] as Entity;
          const node = row[1] as UiNode;
          const state = (row[2] as UiInteraction).state;
          const button = row[3] as UiButton;
          const color =
            app.world.getComponent(entity, Disabled) !== undefined
              ? button.disabled
              : state === 'pressed'
                ? button.pressed
                : state === 'hovered'
                  ? button.hovered
                  : button.normal;
          setUiBackground(node, color);
        }
      },
      { label: 'ui-button-style', after: ['ui-interaction'] },
    );

    // Flip a UiToggle each time its node is clicked, emitting UiToggled. Runs
    // after the picking system so this frame's UiClicked messages are visible.
    app.addSystem(
      'preUpdate',
      [MessageReader(UiClicked), MessageWriter(UiToggled)],
      (clicks, toggled) => {
        const entities: Entity[] = [];
        for (const click of clicks as Iterable<UiClicked>) entities.push(click.entity);
        if (entities.length === 0) return;
        applyToggleClicks(
          entities,
          (entity) => app.world.getComponent(entity, UiToggle),
          (entity) => app.world.getComponent(entity, Disabled) !== undefined,
          (entity) => app.world.markChanged(entity, UiToggle),
          (t2) => (toggled as { write(m: UiToggled): void }).write(t2),
        );
      },
      { label: 'ui-toggle', after: ['ui-interaction'] },
    );

    // Drive each UiToggle's background from its checked state (built-in).
    app.addSystem(
      'preUpdate',
      [Query([UiNode, UiToggle])],
      (togglesQuery) => {
        for (const row of (togglesQuery as { entries(): Iterable<readonly unknown[]> }).entries()) {
          const entity = row[0] as Entity;
          const node = row[1] as UiNode;
          const toggle = row[2] as UiToggle;
          const color =
            app.world.getComponent(entity, Disabled) !== undefined
              ? toggle.disabled
              : toggle.checked
                ? toggle.on
                : toggle.off;
          setUiBackground(node, color);
        }
      },
      { label: 'ui-toggle-style', after: ['ui-toggle'] },
    );
  }
}
