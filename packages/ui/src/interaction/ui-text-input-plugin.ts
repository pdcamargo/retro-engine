import type { Entity } from '@retro-engine/ecs';
import type { App, PluginObject } from '@retro-engine/engine';
import { MessageReader, MessageWriter, Query } from '@retro-engine/engine';
import { KeyboardInput, ReceivedCharacters } from '@retro-engine/input';

import { uiTextInputSchema } from '../register-components';
import { UiFocus } from '../focus/ui-focus';
import { UiText } from '../ui-text';

import { Disabled } from './ui-button';
import { UiClicked } from './ui-clicked';
import {
  applyTextInputFrame,
  type TextEditKey,
  type TextEditState,
  UiTextChanged,
  UiTextInput,
} from './ui-text-input';

/** Physical (layout-independent) caret keys → their edit, checked each frame. */
const EDIT_KEYS: readonly (readonly [string, TextEditKey])[] = [
  ['Backspace', 'backspace'],
  ['Delete', 'delete'],
  ['ArrowLeft', 'left'],
  ['ArrowRight', 'right'],
  ['Home', 'home'],
  ['End', 'end'],
];

/**
 * Drives {@link UiTextInput} editing: clicking a text field focuses it, and the
 * focused field consumes the frame's typed characters ({@link ReceivedCharacters})
 * and caret keys ({@link KeyboardInput}) into its value, mirroring the value into
 * the node's {@link UiText}. Emits {@link UiTextChanged} on value changes.
 *
 * Runs in `preUpdate` after the input drain. Reads {@link UiFocus} and the input
 * resources softly, so it no-ops without an `InputPlugin` / `UiFocusPlugin`
 * (click-to-focus needs `UiFocus`, so add it alongside `UiFocusPlugin`). Add with
 * {@link UiInteractionPlugin} for the click machinery.
 */
export class UiTextInputPlugin implements PluginObject {
  name(): string {
    return 'UiTextInputPlugin';
  }

  build(app: App): void {
    app.addMessage(UiTextChanged);
    app.registerComponent(UiTextInput, uiTextInputSchema, { name: 'UiTextInput', make: () => new UiTextInput() });

    // Click-to-focus + edit the focused field from this frame's text + caret keys.
    app.addSystem(
      'preUpdate',
      [MessageReader(UiClicked), MessageWriter(UiTextChanged)],
      (clicks, changed) => {
        const focus = app.getResource(UiFocus);

        // Clicking a text input focuses it (needs UiFocus from UiFocusPlugin).
        if (focus !== undefined) {
          for (const click of clicks as Iterable<UiClicked>) {
            if (app.world.getComponent(click.entity, UiTextInput) !== undefined) focus.current = click.entity;
          }
        }

        const target = focus?.current ?? null;
        if (target === null) return;
        const input = app.world.getComponent(target, UiTextInput);
        if (input === undefined || app.world.getComponent(target, Disabled) !== undefined) return;

        const keyboard = app.getResource(KeyboardInput);
        const chars = app.getResource(ReceivedCharacters);
        const editKeys: TextEditKey[] = [];
        if (keyboard !== undefined) {
          // justPressed || repeated → caret keys repeat while held, at the OS cadence.
          for (const [code, edit] of EDIT_KEYS) if (keyboard.justPressedOrRepeated(code)) editKeys.push(edit);
        }
        const before: TextEditState = { value: input.value, cursor: input.cursor };
        const state = applyTextInputFrame(before, editKeys, chars?.text() ?? '', input.maxLength);

        const valueChanged = state.value !== input.value;
        if (valueChanged || state.cursor !== input.cursor) {
          input.value = state.value;
          input.cursor = state.cursor;
          app.world.markChanged(target, UiTextInput);
        }
        if (valueChanged) {
          (changed as { write(m: UiTextChanged): void }).write(new UiTextChanged(target, input.value));
        }
      },
      { label: 'ui-text-input', after: ['ui-interaction', 'ui-focus', 'input'] },
    );

    // Mirror every text field's value (or placeholder when empty) into its UiText.
    app.addSystem(
      'preUpdate',
      [Query([UiTextInput, UiText])],
      (rows) => {
        for (const row of (rows as { entries(): Iterable<readonly unknown[]> }).entries()) {
          const input = row[1] as UiTextInput;
          const text = row[2] as UiText;
          const display = input.value.length > 0 ? input.value : input.placeholder;
          if (text.text !== display) {
            text.text = display;
            app.world.markChanged(row[0] as Entity, UiText);
          }
        }
      },
      { label: 'ui-text-input-sync', after: ['ui-text-input'] },
    );
  }
}
