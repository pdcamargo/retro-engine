import type { ActionState } from './action-state';
import type { ActionBinding, ActionMap, BindingRole } from './action-types';
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

const bindingHeld = (
  b: ActionBinding,
  keyboard: ButtonQuery<KeyCode>,
  mouse: ButtonQuery<MouseButton>,
): boolean =>
  b.device === 'key' ? keyboard.pressed(b.code as KeyCode) : mouse.pressed(b.code as MouseButton);

const roleHeld = (
  bindings: readonly ActionBinding[],
  role: BindingRole,
  keyboard: ButtonQuery<KeyCode>,
  mouse: ButtonQuery<MouseButton>,
): boolean => {
  for (const b of bindings) {
    if (b.role === role && bindingHeld(b, keyboard, mouse)) return true;
  }
  return false;
};

/**
 * Recompute one entity's {@link ActionState} from its {@link ActionMap} and the
 * current device inputs. Snapshots the previous frame's held state first (so
 * `justPressed` / `justReleased` are correct), then evaluates every action:
 * button (any trigger held), `axis` (positiveX − negativeX), and `axis2d`
 * (a virtual D-pad into `{ x, y }`).
 *
 * Runs once per `(ActionMap, ActionState)` entity each frame in `preUpdate`
 * after the raw device update. Exported for the bench and tests.
 *
 * @internal
 */
export const resolveActionState = (
  map: ActionMap,
  state: ActionState,
  keyboard: ButtonQuery<KeyCode>,
  mouse: ButtonQuery<MouseButton>,
): void => {
  // Roll this frame's held state into "previous" before recomputing.
  state.prevPressedMap.clear();
  for (const [name, held] of state.pressedMap) state.prevPressedMap.set(name, held);

  for (const def of map.defs) {
    switch (def.kind) {
      case 'button': {
        const held = roleHeld(def.bindings, 'trigger', keyboard, mouse);
        state.pressedMap.set(def.name, held);
        state.valueMap.set(def.name, held ? 1 : 0);
        break;
      }
      case 'axis': {
        const pos = roleHeld(def.bindings, 'positiveX', keyboard, mouse) ? 1 : 0;
        const neg = roleHeld(def.bindings, 'negativeX', keyboard, mouse) ? 1 : 0;
        const v = pos - neg;
        state.valueMap.set(def.name, v);
        state.pressedMap.set(def.name, v !== 0);
        break;
      }
      case 'axis2d': {
        const x =
          (roleHeld(def.bindings, 'positiveX', keyboard, mouse) ? 1 : 0) -
          (roleHeld(def.bindings, 'negativeX', keyboard, mouse) ? 1 : 0);
        const y =
          (roleHeld(def.bindings, 'positiveY', keyboard, mouse) ? 1 : 0) -
          (roleHeld(def.bindings, 'negativeY', keyboard, mouse) ? 1 : 0);
        state.vec2Map.set(def.name, { x, y });
        state.valueMap.set(def.name, Math.hypot(x, y));
        state.pressedMap.set(def.name, x !== 0 || y !== 0);
        break;
      }
    }
  }
};
