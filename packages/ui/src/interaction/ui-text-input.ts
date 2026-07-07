import type { Entity } from '@retro-engine/ecs';

import { UiNode } from '../ui-node';
import { Focusable } from '../focus/ui-focus';

import { Interactable } from './ui-interaction';

/** Initializer for {@link UiTextInput}; omitted fields take the defaults below. */
export interface UiTextInputOptions {
  /** Initial text. Default `''`. */
  value?: string;
  /** Caret index into {@link UiTextInput.value}. Default: end of the initial value. */
  cursor?: number;
  /** Maximum length; `0` (the default) is unbounded. */
  maxLength?: number;
  /** Hint shown (as the node's text) while the value is empty. Default `''`. */
  placeholder?: string;
}

/**
 * An editable single-line text field. Focus it (click, or via `UiNavigate`), then
 * a built-in system applies the frame's typed characters (`ReceivedCharacters`)
 * and editing keys (Backspace / Delete / arrows / Home / End) to
 * {@link UiTextInput.value} and mirrors the value into the node's {@link UiText}
 * for rendering (its {@link UiTextInput.placeholder} shows while empty). Emits
 * {@link UiTextChanged} when the value changes.
 *
 * Authored + reflection-registered; adding it auto-attaches {@link Interactable}
 * (click-to-focus) and {@link Focusable} (so navigation can reach it), and thus a
 * {@link UiNode}. `cursor` is transient caret state and is not serialized.
 */
export class UiTextInput {
  value: string;
  /** Caret index in `[0, value.length]`. Transient — not serialized. */
  cursor: number;
  maxLength: number;
  placeholder: string;

  constructor(options: UiTextInputOptions = {}) {
    this.value = options.value ?? '';
    this.cursor = options.cursor ?? this.value.length;
    this.maxLength = options.maxLength ?? 0;
    this.placeholder = options.placeholder ?? '';
  }

  static readonly requires = [UiNode, Interactable, Focusable];
}

/**
 * Emitted when a {@link UiTextInput}'s value changes from editing, carrying the
 * entity and its new value. Read with `MessageReader(UiTextChanged)`.
 */
export class UiTextChanged {
  constructor(
    public readonly entity: Entity,
    public readonly value: string,
  ) {}
}

/** A caret-editing key (physical, layout-independent), the non-text half of text input. */
export type TextEditKey = 'backspace' | 'delete' | 'left' | 'right' | 'home' | 'end';

/** The mutable editing state a text field folds edits over: its text and caret. */
export interface TextEditState {
  readonly value: string;
  readonly cursor: number;
}

/** Clamp a caret index into `[0, length]`. */
const clampCursor = (cursor: number, length: number): number =>
  cursor < 0 ? 0 : cursor > length ? length : cursor;

/**
 * Apply one caret-editing key to `{ value, cursor }`, returning the new state.
 * Backspace removes before the caret, Delete removes at it, the arrows / Home /
 * End move it. Pure — the editing half of the text-input widget, unit-tested.
 */
export const applyEditKey = (state: TextEditState, key: TextEditKey): TextEditState => {
  const { value } = state;
  const cursor = clampCursor(state.cursor, value.length);
  switch (key) {
    case 'backspace':
      return cursor > 0
        ? { value: value.slice(0, cursor - 1) + value.slice(cursor), cursor: cursor - 1 }
        : { value, cursor };
    case 'delete':
      return cursor < value.length
        ? { value: value.slice(0, cursor) + value.slice(cursor + 1), cursor }
        : { value, cursor };
    case 'left':
      return { value, cursor: cursor > 0 ? cursor - 1 : 0 };
    case 'right':
      return { value, cursor: cursor < value.length ? cursor + 1 : value.length };
    case 'home':
      return { value, cursor: 0 };
    case 'end':
      return { value, cursor: value.length };
  }
};

/**
 * Insert `text` at the caret, respecting `maxLength` (`0` = unbounded): the
 * insertion is truncated to what fits, and the caret advances by the number of
 * characters actually inserted. Pure — the text half of the widget, unit-tested.
 */
export const insertText = (state: TextEditState, text: string, maxLength = 0): TextEditState => {
  const cursor = clampCursor(state.cursor, state.value.length);
  const room = maxLength > 0 ? Math.max(0, maxLength - state.value.length) : text.length;
  const insert = room >= text.length ? text : text.slice(0, room);
  if (insert.length === 0) return { value: state.value, cursor };
  return {
    value: state.value.slice(0, cursor) + insert + state.value.slice(cursor),
    cursor: cursor + insert.length,
  };
};

/**
 * Fold one frame of text-input onto `state`: apply the caret {@link TextEditKey}s
 * (in order), then insert this frame's typed `text` at the resulting caret. This
 * ordering (edits before insertion) is the widget system's per-frame contract;
 * pure and unit-tested so the combined behaviour is verified without an ECS.
 */
export const applyTextInputFrame = (
  state: TextEditState,
  editKeys: readonly TextEditKey[],
  text: string,
  maxLength = 0,
): TextEditState => {
  let next = state;
  for (const key of editKeys) next = applyEditKey(next, key);
  return text.length > 0 ? insertText(next, text, maxLength) : next;
};
