import type { GamepadAxis, GamepadButton } from './gamepad-mapping';
import { ActionState } from './action-state';
import type { KeyCode } from './keyboard';
import type { MouseButton } from './mouse';

/** Which device an {@link ActionBinding} reads. */
export type InputDevice = 'key' | 'mouse' | 'gamepad';

/**
 * The part an {@link ActionBinding} plays in its action:
 * - `'trigger'` — a button press for a `button` action.
 * - `'positiveX'` / `'negativeX'` — the +1 / −1 legs of an `axis` (and the X of
 *   an `axis2d`).
 * - `'positiveY'` / `'negativeY'` — the +1 / −1 legs of an `axis2d`'s Y.
 * - `'analogX'` / `'analogY'` — a continuous analog source (a gamepad stick axis)
 *   feeding the X / Y of an `axis` / `axis2d` directly, rather than a discrete leg.
 */
export type BindingRole =
  | 'trigger'
  | 'positiveX'
  | 'negativeX'
  | 'positiveY'
  | 'negativeY'
  | 'analogX'
  | 'analogY';

/**
 * The shape of an action's resolved value:
 * - `'button'` — pressed / released.
 * - `'axis'` — a single value in `[-1, 1]`.
 * - `'axis2d'` — an `{ x, y }` pair, each in `[-1, 1]`.
 */
export type ActionKind = 'button' | 'axis' | 'axis2d';

/** A physical input source, produced by {@link key} / {@link mouseButton}. */
export interface ActionSource {
  readonly device: InputDevice;
  readonly code: string;
}

/** A keyboard source for an action binding (physical {@link KeyCode}). */
export const key = (code: KeyCode): ActionSource => ({ device: 'key', code });

/** A mouse-button source for an action binding. */
export const mouseButton = (button: MouseButton): ActionSource => ({ device: 'mouse', code: button });

/**
 * A gamepad-button source for an action binding — read from the first connected
 * pad. Digital only (D-pad, face/shoulder buttons, clicked sticks); analog stick
 * axes are a separate follow-up.
 */
export const gamepadButton = (button: GamepadButton): ActionSource => ({ device: 'gamepad', code: button });

/**
 * A gamepad analog-axis source for an `axis` / `axis2d` binding — the continuous
 * `[-1, 1]` reading of one stick axis (or `[0, 1]` for a trigger), read from the
 * first connected pad. Bind it through the `analog` option of {@link ActionMap.axis} /
 * {@link ActionMap.axis2d}, or the {@link ActionMap.stick} / {@link ActionMap.stick2d}
 * shorthands. Stick Y is oriented so up is `+1`.
 */
export const gamepadAxis = (axis: GamepadAxis): ActionSource => ({ device: 'gamepad', code: axis });

/**
 * One physical input mapped into an action, in a specific {@link BindingRole}.
 * A serializable value type (registered via `registerType`); authored through
 * {@link ActionMap}'s builder methods rather than constructed directly.
 */
export class ActionBinding {
  role: BindingRole;
  device: InputDevice;
  code: string;

  constructor(role: BindingRole = 'trigger', device: InputDevice = 'key', code = '') {
    this.role = role;
    this.device = device;
    this.code = code;
  }
}

/**
 * A single named action and every physical input bound to it. A serializable
 * value type; authored through {@link ActionMap}'s builder methods.
 */
export class ActionDef {
  name: string;
  kind: ActionKind;
  bindings: ActionBinding[];

  constructor(name = '', kind: ActionKind = 'button', bindings: ActionBinding[] = []) {
    this.name = name;
    this.kind = kind;
    this.bindings = bindings;
  }
}

const binding = (role: BindingRole, source: ActionSource): ActionBinding =>
  new ActionBinding(role, source.device, source.code);

/**
 * Authored mapping from named actions to physical inputs, read via
 * `Res`/`Query` as a component. Attach one to the player entity; its resolved
 * {@link ActionState} is auto-attached (a Required Component) and refreshed each
 * frame. Serializes with the scene (ADR-0145), so bindings survive a save and
 * can be rebound at runtime by mutating {@link ActionMap.defs}.
 *
 * @example
 * ```ts
 * const map = new ActionMap()
 *   .button('Jump', key('Space'))
 *   .axis('MoveX', { negative: key('KeyA'), positive: key('KeyD') })
 *   .axis2d('Move', { left: key('KeyA'), right: key('KeyD'), down: key('KeyS'), up: key('KeyW') });
 * cmd.spawn(map);
 * ```
 */
export class ActionMap {
  /**
   * Spawning an entity with an `ActionMap` auto-inserts a default
   * {@link ActionState} the resolution system fills each frame (ECS Required
   * Components, as `Transform` pulls in `GlobalTransform`).
   */
  static readonly requires = [ActionState];

  /** Every action defined on this map. Mutate to rebind at runtime. */
  defs: ActionDef[] = [];

  /** Look up an action's definition by name, or `undefined` if unbound. */
  get(name: string): ActionDef | undefined {
    return this.defs.find((d) => d.name === name);
  }

  /**
   * Define a button action pressed while any of `sources` is held. Multiple
   * sources are OR-ed (keyboard *or* mouse). Chainable.
   */
  button(name: string, ...sources: ActionSource[]): this {
    this.defs.push(
      new ActionDef(
        name,
        'button',
        sources.map((s) => binding('trigger', s)),
      ),
    );
    return this;
  }

  /**
   * Define a 1D axis whose value is `+1` while `positive` is held, `-1` while
   * `negative` is held, `0` otherwise (both held cancels). Pass `analog` to also
   * drive it from a continuous gamepad axis (via {@link gamepadAxis}); the
   * larger-magnitude of the digital legs and the analog value wins. Chainable.
   */
  axis(
    name: string,
    legs: { negative: ActionSource; positive: ActionSource; analog?: ActionSource },
  ): this {
    const bindings = [binding('negativeX', legs.negative), binding('positiveX', legs.positive)];
    if (legs.analog !== undefined) bindings.push(binding('analogX', legs.analog));
    this.defs.push(new ActionDef(name, 'axis', bindings));
    return this;
  }

  /**
   * Define a 2D axis (a virtual D-pad) whose `{ x, y }` is composed from four
   * directional buttons. `+y` is up. Diagonals are raw (magnitude up to √2);
   * normalize if you want unit-speed diagonals. Pass `analog` to also drive each
   * component from a continuous gamepad axis (via {@link gamepadAxis}); per
   * component the larger-magnitude of the digital legs and the analog value wins.
   * Chainable.
   */
  axis2d(
    name: string,
    dirs: {
      left: ActionSource;
      right: ActionSource;
      up: ActionSource;
      down: ActionSource;
      analog?: { x: ActionSource; y: ActionSource };
    },
  ): this {
    const bindings = [
      binding('negativeX', dirs.left),
      binding('positiveX', dirs.right),
      binding('positiveY', dirs.up),
      binding('negativeY', dirs.down),
    ];
    if (dirs.analog !== undefined) {
      bindings.push(binding('analogX', dirs.analog.x), binding('analogY', dirs.analog.y));
    }
    this.defs.push(new ActionDef(name, 'axis2d', bindings));
    return this;
  }

  /**
   * Define a 1D axis driven directly by a single continuous analog source (a
   * gamepad stick axis or trigger, via {@link gamepadAxis}) — its `[-1, 1]`
   * reading is the axis value. Shorthand for {@link ActionMap.axis} with only an
   * `analog` binding. Chainable.
   */
  stick(name: string, source: ActionSource): this {
    this.defs.push(new ActionDef(name, 'axis', [binding('analogX', source)]));
    return this;
  }

  /**
   * Define a 2D axis driven directly by two continuous analog sources (a gamepad
   * stick's X/Y axes, via {@link gamepadAxis}) — their `[-1, 1]` readings are the
   * `{ x, y }`. `+y` is up (stick Y is oriented on ingest). Shorthand for
   * {@link ActionMap.axis2d} with only `analog` bindings. Chainable.
   */
  stick2d(name: string, axes: { x: ActionSource; y: ActionSource }): this {
    this.defs.push(
      new ActionDef(name, 'axis2d', [binding('analogX', axes.x), binding('analogY', axes.y)]),
    );
    return this;
  }
}
