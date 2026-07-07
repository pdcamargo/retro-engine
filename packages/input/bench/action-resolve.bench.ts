// Per-frame cost of resolving an entity's ActionState from its ActionMap
// (ADR-0145). This runs once per input-mapped entity every frame in preUpdate,
// so it must stay cheap as the number of actions/bindings grows. See ADR-0017.

import { bench, summary } from 'mitata';

import { resolveActionState } from '../src/action-resolve';
import { ActionState } from '../src/action-state';
import { ActionMap, gamepadAxis, key, mouseButton } from '../src/action-types';
import { Axis } from '../src/axis';
import { ButtonInput } from '../src/button-input';
import type { GamepadAxis, GamepadButton } from '../src/gamepad-mapping';
import { KeyboardInput } from '../src/keyboard';
import { MouseButtonInput } from '../src/mouse';

const makeMap = (buttons: number): ActionMap => {
  const map = new ActionMap()
    // A stick-plus-keyboard Move exercises the analog combine path per component.
    .axis2d('Move', {
      left: key('KeyA'),
      right: key('KeyD'),
      up: key('KeyW'),
      down: key('KeyS'),
      analog: { x: gamepadAxis('LeftStickX'), y: gamepadAxis('LeftStickY') },
    })
    .axis('Look', { negative: key('KeyQ'), positive: key('KeyE') })
    .button('Fire', key('KeyF'), mouseButton('Left'));
  for (let i = 0; i < buttons; i += 1) map.button(`Action${i}`, key(`Key${i}`));
  return map;
};

for (const buttons of [4, 16, 64]) {
  summary(() => {
    bench(`resolveActionState @ ${buttons + 3} actions`, function* () {
      const map = makeMap(buttons);
      const state = new ActionState();
      const keyboard = new KeyboardInput();
      const mouse = new MouseButtonInput();
      const gamepad = new ButtonInput<GamepadButton>();
      const axes = new Axis<GamepadAxis>();
      // A realistic mix of held inputs.
      keyboard.press('KeyW');
      keyboard.press('KeyD');
      mouse.press('Left');
      axes.set('LeftStickX', 0.6);
      const gamepadAxes = { value: (a: GamepadAxis): number => axes.getOrZero(a) };
      yield () => resolveActionState(map, state, { keyboard, mouse, gamepad, gamepadAxes });
    });
  });
}
