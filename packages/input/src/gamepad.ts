import { Axis } from './axis';
import { ButtonInput } from './button-input';
import type { GamepadAxis, GamepadButton } from './gamepad-mapping';
import {
  LEFT_TRIGGER_BUTTON,
  RIGHT_TRIGGER_BUTTON,
  STANDARD_BUTTONS,
  STANDARD_STICK_AXES,
} from './gamepad-mapping';
import type { GamepadSnapshot, GamepadSource } from './gamepad-source';

/**
 * Rescale a raw axis value against a dead zone: values with magnitude below
 * `deadZone` read as `0`; above it, the remaining range is stretched back to
 * `[0, 1]` so the value ramps smoothly from the edge of the zone. Sign is
 * preserved.
 */
export const applyDeadZone = (value: number, deadZone: number): number => {
  const magnitude = Math.abs(value);
  if (magnitude < deadZone) return 0;
  const scaled = (magnitude - deadZone) / (1 - deadZone);
  return value < 0 ? -scaled : scaled;
};

/**
 * The live state of a single connected gamepad. Reuses the input primitives: a
 * {@link ButtonInput} of {@link GamepadButton}s (digital, with per-frame
 * edges), and an {@link Axis} of {@link GamepadAxis}es (analog, dead-zoned).
 * Raw index access (`buttonAt` / `axisAt`) always works, even for non-standard
 * pads whose names are not mapped.
 */
export class GamepadState {
  readonly index: number;
  id: string;
  /** Whether this pad was present in the most recent poll. */
  connected = true;
  /** Digital buttons by standard name (empty for non-standard mappings). */
  readonly buttons = new ButtonInput<GamepadButton>();
  /** Analog axes by standard name (dead-zoned; empty for non-standard mappings). */
  readonly axes = new Axis<GamepadAxis>();

  private readonly buttonValues = new Map<GamepadButton, number>();
  private rawPressed: readonly boolean[] = [];
  private rawValues: readonly number[] = [];
  private rawAxes: readonly number[] = [];

  constructor(index: number, id: string) {
    this.index = index;
    this.id = id;
  }

  /** Analog value `[0, 1]` of a named button (meaningful for the triggers). */
  buttonValue(button: GamepadButton): number {
    return this.buttonValues.get(button) ?? 0;
  }

  /** Whether the raw `Gamepad.buttons[index]` is pressed (any mapping). */
  buttonAt(index: number): boolean {
    return this.rawPressed[index] ?? false;
  }

  /** Raw analog value of `Gamepad.buttons[index]` (any mapping). */
  buttonValueAt(index: number): number {
    return this.rawValues[index] ?? 0;
  }

  /** Raw value of `Gamepad.axes[index]` (any mapping; not dead-zoned or Y-flipped). */
  axisAt(index: number): number {
    return this.rawAxes[index] ?? 0;
  }

  /** @internal Apply a fresh snapshot. Assumes `buttons.clear()` already ran this frame. */
  applySnapshot(snapshot: GamepadSnapshot, deadZone: number): void {
    this.id = snapshot.id;
    this.rawPressed = snapshot.buttons.map((b) => b.pressed);
    this.rawValues = snapshot.buttons.map((b) => b.value);
    this.rawAxes = snapshot.axes;

    if (snapshot.mapping === 'standard') {
      for (let i = 0; i < STANDARD_BUTTONS.length; i += 1) {
        const name = STANDARD_BUTTONS[i]!;
        const btn = snapshot.buttons[i];
        if (btn?.pressed) this.buttons.press(name);
        else this.buttons.release(name);
        this.buttonValues.set(name, btn?.value ?? 0);
      }
      for (let i = 0; i < STANDARD_STICK_AXES.length; i += 1) {
        const name = STANDARD_STICK_AXES[i]!;
        // The API reports stick-up as negative; flip Y so up is +1.
        const raw = snapshot.axes[i] ?? 0;
        const oriented = name.endsWith('Y') ? -raw : raw;
        this.axes.set(name, applyDeadZone(oriented, deadZone));
      }
      this.axes.set('LeftTrigger', snapshot.buttons[LEFT_TRIGGER_BUTTON]?.value ?? 0);
      this.axes.set('RightTrigger', snapshot.buttons[RIGHT_TRIGGER_BUTTON]?.value ?? 0);
    }
  }

  /** @internal Zero the analog state (called when the pad disconnects). */
  zeroAnalog(): void {
    this.buttonValues.clear();
    this.rawPressed = [];
    this.rawValues = [];
    this.rawAxes = [];
    for (const axis of this.axes.getAll()) this.axes.set(axis, 0);
  }
}

/**
 * All connected gamepads, read via `Res(Gamepads)`. Keyed by the pad's Web
 * Gamepad API index; refreshed each frame by polling the {@link GamepadSource}.
 * Transient — never serialized.
 *
 * @example
 * ```ts
 * app.addSystem('update', [Res(Gamepads)], (pads) => {
 *   const pad = pads.first();
 *   if (pad?.buttons.justPressed('South')) jump();
 *   const x = pad?.axes.getOrZero('LeftStickX') ?? 0;
 * });
 * ```
 */
export class Gamepads {
  /**
   * Stick dead zone applied per axis, `[0, 1)`. Values below it read as 0.
   * Default `0.1`.
   */
  deadZone = 0.1;

  private readonly pads = new Map<number, GamepadState>();

  /** The pad at `index`, connected or not, or `undefined` if never seen. */
  get(index: number): GamepadState | undefined {
    return this.pads.get(index);
  }

  /** The lowest-indexed connected pad — the single-player convenience. */
  first(): GamepadState | undefined {
    let best: GamepadState | undefined;
    for (const pad of this.pads.values()) {
      if (pad.connected && (best === undefined || pad.index < best.index)) best = pad;
    }
    return best;
  }

  /** Every known pad (including disconnected ones still in the table). */
  all(): IterableIterator<GamepadState> {
    return this.pads.values();
  }

  /** Indices of the currently-connected pads, ascending. */
  connectedIndices(): number[] {
    const out: number[] = [];
    for (const pad of this.pads.values()) if (pad.connected) out.push(pad.index);
    return out.sort((a, b) => a - b);
  }

  /** @internal Insert a freshly-seen pad. */
  add(state: GamepadState): void {
    this.pads.set(state.index, state);
  }
}

/**
 * Poll `source` and reconcile `gamepads`: create newly-seen pads, refresh every
 * pad's button/axis state, and mark pads absent from the poll as disconnected
 * (releasing their held buttons and zeroing analog state). Runs once per frame
 * in `preUpdate`. Exported for the bench and tests.
 *
 * @internal
 */
export const updateGamepads = (gamepads: Gamepads, source: GamepadSource): void => {
  const snapshots = source.poll();
  const byIndex = new Map<number, GamepadSnapshot>();
  for (const snap of snapshots) {
    byIndex.set(snap.index, snap);
    if (gamepads.get(snap.index) === undefined) {
      gamepads.add(new GamepadState(snap.index, snap.id));
    }
  }

  for (const pad of gamepads.all()) {
    // Clear last frame's transitions on every known pad, so a disconnect frame's
    // just-released edge is dropped on the following frame.
    pad.buttons.clear();
    const snap = byIndex.get(pad.index);
    if (snap !== undefined) {
      pad.connected = true;
      pad.applySnapshot(snap, gamepads.deadZone);
    } else if (pad.connected) {
      pad.connected = false;
      pad.buttons.releaseAll();
      pad.zeroAnalog();
    }
  }
};
