/**
 * The information from a key-down needed to decide whether it produced a text
 * character: the layout-and-shift-resolved key value (DOM `KeyboardEvent.key`)
 * and the command modifiers held with it.
 */
export interface KeyCharInput {
  /** The produced key value — a single character for printable keys, else a named key (`'Enter'`, `'Shift'`, …). */
  readonly key: string;
  /** Control key held (a shortcut, not text) — unless combined with Alt (AltGr). */
  readonly ctrl?: boolean;
  /** Meta / Command / Windows key held (a shortcut, not text). */
  readonly meta?: boolean;
  /** Alt / Option held. With Ctrl this is AltGr, which *does* produce text on some layouts. */
  readonly alt?: boolean;
}

/**
 * The text character a key-down produced, or `null` if it produced none — a
 * named key (`Enter`, arrows, modifiers, whose `key` is longer than one
 * character) or a command chord (Ctrl / Meta held). AltGr (`Ctrl+Alt`) is
 * allowed through because it types characters on many keyboard layouts. Pure —
 * the text-input filter, unit-tested; keyed off `KeyboardEvent.key` so the
 * character respects the OS layout and Shift, unlike the physical `KeyCode`.
 */
export const charFromKeyDown = (ev: KeyCharInput): string | null => {
  if (ev.meta === true) return null;
  if (ev.ctrl === true && ev.alt !== true) return null;
  return ev.key.length === 1 ? ev.key : null;
};

/**
 * Text characters typed this frame, read via `Res(ReceivedCharacters)`. A
 * layout-and-shift-aware stream distinct from the physical {@link KeyboardInput}
 * button state: use this to append to a text field, {@link KeyboardInput} to
 * bind gameplay keys. `InputPlugin` clears it at the start of each frame and
 * fills it from the backend's key-downs, so it holds only the current frame's
 * input.
 *
 * @example
 * ```ts
 * app.addSystem('update', [Res(ReceivedCharacters), ResMut(MyField)], (typed, field) => {
 *   field.value += typed.text();
 * });
 * ```
 */
export class ReceivedCharacters {
  private readonly buffer: string[] = [];

  /** Append a character received this frame. */
  push(char: string): void {
    this.buffer.push(char);
  }

  /** Drop all characters (called at the start of each frame). */
  clear(): void {
    this.buffer.length = 0;
  }

  /** The characters received this frame, in order. */
  chars(): readonly string[] {
    return this.buffer;
  }

  /** The characters received this frame joined into a string. */
  text(): string {
    return this.buffer.join('');
  }

  /** How many characters were received this frame. */
  get length(): number {
    return this.buffer.length;
  }
}
