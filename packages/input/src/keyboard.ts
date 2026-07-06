import { ButtonInput } from './button-input';

/**
 * A physical key identifier, matching the DOM `KeyboardEvent.code` value.
 *
 * These name **key positions**, not the characters they produce, so a binding
 * to `'KeyW'` stays on the same physical key across keyboard layouts (WASD
 * remains WASD on AZERTY). This is the layout-independent identity games want.
 *
 * The union covers the standard keys; because the DOM can in principle report
 * codes outside it (exotic hardware, browser quirks), the backend does not gate
 * on the union — an unlisted code still flows through as its raw string. Widen
 * a binding with a cast if you need one of those.
 */
export type KeyCode =
  // Letters
  | 'KeyA' | 'KeyB' | 'KeyC' | 'KeyD' | 'KeyE' | 'KeyF' | 'KeyG' | 'KeyH'
  | 'KeyI' | 'KeyJ' | 'KeyK' | 'KeyL' | 'KeyM' | 'KeyN' | 'KeyO' | 'KeyP'
  | 'KeyQ' | 'KeyR' | 'KeyS' | 'KeyT' | 'KeyU' | 'KeyV' | 'KeyW' | 'KeyX'
  | 'KeyY' | 'KeyZ'
  // Top-row digits
  | 'Digit0' | 'Digit1' | 'Digit2' | 'Digit3' | 'Digit4'
  | 'Digit5' | 'Digit6' | 'Digit7' | 'Digit8' | 'Digit9'
  // Function keys
  | 'F1' | 'F2' | 'F3' | 'F4' | 'F5' | 'F6' | 'F7' | 'F8'
  | 'F9' | 'F10' | 'F11' | 'F12'
  // Whitespace / editing
  | 'Space' | 'Enter' | 'Tab' | 'Backspace' | 'Escape' | 'Delete' | 'Insert'
  // Arrows
  | 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'
  // Navigation
  | 'Home' | 'End' | 'PageUp' | 'PageDown'
  // Modifiers
  | 'ShiftLeft' | 'ShiftRight' | 'ControlLeft' | 'ControlRight'
  | 'AltLeft' | 'AltRight' | 'MetaLeft' | 'MetaRight'
  | 'CapsLock' | 'ContextMenu'
  // Punctuation
  | 'Minus' | 'Equal' | 'BracketLeft' | 'BracketRight' | 'Backslash'
  | 'Semicolon' | 'Quote' | 'Backquote' | 'Comma' | 'Period' | 'Slash'
  // Numpad
  | 'Numpad0' | 'Numpad1' | 'Numpad2' | 'Numpad3' | 'Numpad4'
  | 'Numpad5' | 'Numpad6' | 'Numpad7' | 'Numpad8' | 'Numpad9'
  | 'NumpadAdd' | 'NumpadSubtract' | 'NumpadMultiply' | 'NumpadDivide'
  | 'NumpadDecimal' | 'NumpadEnter' | 'NumLock'
  // Allow any other DOM code through without losing autocomplete on the above.
  | (string & {});

/**
 * Per-frame keyboard button state, read via `Res(KeyboardInput)`. A concrete
 * subclass of {@link ButtonInput} keyed on physical {@link KeyCode}s; a
 * distinct class (rather than a bare `ButtonInput<KeyCode>`) so the
 * constructor-keyed resource map can hold it alongside the mouse buttons.
 *
 * @example
 * ```ts
 * app.addSystem('update', [Res(KeyboardInput)], (keys) => {
 *   if (keys.justPressed('Space')) jump();
 *   if (keys.pressed('KeyW')) moveForward();
 * });
 * ```
 */
export class KeyboardInput extends ButtonInput<KeyCode> {}
