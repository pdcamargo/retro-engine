import type { ActionState } from './action-state';
import type { ActionBinding, ActionMap, BindingRole } from './action-types';
import type { GamepadAxis, GamepadButton } from './gamepad-mapping';
import type { KeyCode } from './keyboard';
import type { MouseButton } from './mouse';

/**
 * Minimal read-only view of a {@link ButtonInput} the resolver needs. Typed
 * structurally so it accepts both a live `KeyboardInput` and the read-only
 * `Res(...)` projection the system param hands over.
 */
interface ButtonQuery<T> {
  pressed(input: T): boolean;
}

/**
 * Minimal read-only view of an {@link Axis} the resolver needs for analog
 * bindings. Typed structurally so it accepts a live `Axis<GamepadAxis>` or a
 * small adapter over the first connected pad.
 */
interface AxisQuery<T> {
  value(axis: T): number;
}

/** The device inputs the resolver reads a binding's state from. */
export interface ActionInputs {
  readonly keyboard: ButtonQuery<KeyCode>;
  readonly mouse: ButtonQuery<MouseButton>;
  readonly gamepad: ButtonQuery<GamepadButton>;
  /** Continuous gamepad axes, read by `analogX` / `analogY` bindings. */
  readonly gamepadAxes: AxisQuery<GamepadAxis>;
}

const bindingHeld = (b: ActionBinding, inputs: ActionInputs): boolean => {
  switch (b.device) {
    case 'key':
      return inputs.keyboard.pressed(b.code as KeyCode);
    case 'mouse':
      return inputs.mouse.pressed(b.code as MouseButton);
    case 'gamepad':
      return inputs.gamepad.pressed(b.code as GamepadButton);
  }
};

const roleHeld = (bindings: readonly ActionBinding[], role: BindingRole, inputs: ActionInputs): boolean => {
  for (const b of bindings) {
    if (b.role === role && bindingHeld(b, inputs)) return true;
  }
  return false;
};

/**
 * The largest-magnitude continuous value among a role's analog bindings (each a
 * gamepad axis). `0` when the role has no analog bindings. Used to fold a stick
 * axis into a composite axis alongside the digital legs.
 */
const analogValue = (bindings: readonly ActionBinding[], role: BindingRole, inputs: ActionInputs): number => {
  let best = 0;
  for (const b of bindings) {
    if (b.role !== role) continue;
    const v = inputs.gamepadAxes.value(b.code as GamepadAxis);
    if (Math.abs(v) > Math.abs(best)) best = v;
  }
  return best;
};

/** Keep whichever of the digital and analog values has the larger magnitude, clamped to `[-1, 1]`. */
const combineAxis = (digital: number, analog: number): number => {
  const v = Math.abs(analog) > Math.abs(digital) ? analog : digital;
  return v < -1 ? -1 : v > 1 ? 1 : v;
};

/**
 * Recompute one entity's {@link ActionState} from its {@link ActionMap} and the
 * current device inputs. Snapshots the previous frame's held state first (so
 * `justPressed` / `justReleased` are correct), then evaluates every action:
 * button (any trigger held), `axis` (positiveX − negativeX, or an analog stick
 * axis — larger magnitude wins), and `axis2d` (a virtual D-pad, or a stick, into
 * `{ x, y }`).
 *
 * Runs once per `(ActionMap, ActionState)` entity each frame in `preUpdate`
 * after the raw device update. Exported for the bench and tests.
 *
 * @internal
 */
export const resolveActionState = (map: ActionMap, state: ActionState, inputs: ActionInputs): void => {
  // Roll this frame's held state into "previous" before recomputing.
  state.prevPressedMap.clear();
  for (const [name, held] of state.pressedMap) state.prevPressedMap.set(name, held);

  for (const def of map.defs) {
    switch (def.kind) {
      case 'button': {
        const held = roleHeld(def.bindings, 'trigger', inputs);
        state.pressedMap.set(def.name, held);
        state.valueMap.set(def.name, held ? 1 : 0);
        break;
      }
      case 'axis': {
        const pos = roleHeld(def.bindings, 'positiveX', inputs) ? 1 : 0;
        const neg = roleHeld(def.bindings, 'negativeX', inputs) ? 1 : 0;
        const v = combineAxis(pos - neg, analogValue(def.bindings, 'analogX', inputs));
        state.valueMap.set(def.name, v);
        state.pressedMap.set(def.name, v !== 0);
        break;
      }
      case 'axis2d': {
        const digX =
          (roleHeld(def.bindings, 'positiveX', inputs) ? 1 : 0) -
          (roleHeld(def.bindings, 'negativeX', inputs) ? 1 : 0);
        const digY =
          (roleHeld(def.bindings, 'positiveY', inputs) ? 1 : 0) -
          (roleHeld(def.bindings, 'negativeY', inputs) ? 1 : 0);
        const x = combineAxis(digX, analogValue(def.bindings, 'analogX', inputs));
        const y = combineAxis(digY, analogValue(def.bindings, 'analogY', inputs));
        state.vec2Map.set(def.name, { x, y });
        state.valueMap.set(def.name, Math.hypot(x, y));
        state.pressedMap.set(def.name, x !== 0 || y !== 0);
        break;
      }
    }
  }
};
