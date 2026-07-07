import { describe, expect, it } from 'bun:test';

import { resolveActionState } from './action-resolve';
import { ActionState } from './action-state';
import { ActionMap, gamepadAxis, gamepadButton, key, mouseButton } from './action-types';
import { Axis } from './axis';
import { ButtonInput } from './button-input';
import type { GamepadAxis, GamepadButton } from './gamepad-mapping';
import { KeyboardInput } from './keyboard';
import { MouseButtonInput } from './mouse';

interface Harness {
  readonly map: ActionMap;
  readonly state: ActionState;
  readonly keyboard: KeyboardInput;
  readonly mouse: MouseButtonInput;
  readonly gamepad: ButtonInput<GamepadButton>;
  readonly axes: Axis<GamepadAxis>;
  resolve(): void;
}

const harness = (map: ActionMap): Harness => {
  const state = new ActionState();
  const keyboard = new KeyboardInput();
  const mouse = new MouseButtonInput();
  const gamepad = new ButtonInput<GamepadButton>();
  const axes = new Axis<GamepadAxis>();
  return {
    map,
    state,
    keyboard,
    mouse,
    gamepad,
    axes,
    resolve() {
      // The plugin clears device transitions each frame; the action layer only
      // reads `pressed`, so held state is what matters here.
      resolveActionState(map, state, {
        keyboard,
        mouse,
        gamepad,
        gamepadAxes: { value: (a) => axes.getOrZero(a) },
      });
    },
  };
};

describe('ActionMap builder', () => {
  it('button() records a trigger binding', () => {
    const map = new ActionMap().button('Jump', key('Space'));
    const def = map.get('Jump');
    expect(def?.kind).toBe('button');
    expect(def?.bindings).toEqual([{ role: 'trigger', device: 'key', code: 'Space' }]);
  });

  it('button() with multiple sources records all as triggers', () => {
    const map = new ActionMap().button('Fire', key('KeyF'), mouseButton('Left'));
    expect(map.get('Fire')?.bindings.map((b) => b.code)).toEqual(['KeyF', 'Left']);
    expect(map.get('Fire')?.bindings.every((b) => b.role === 'trigger')).toBe(true);
  });

  it('axis() records negative/positive legs', () => {
    const map = new ActionMap().axis('MoveX', { negative: key('KeyA'), positive: key('KeyD') });
    const roles = map.get('MoveX')?.bindings.map((b) => b.role);
    expect(roles).toEqual(['negativeX', 'positiveX']);
  });

  it('axis2d() records all four directions', () => {
    const map = new ActionMap().axis2d('Move', {
      left: key('KeyA'),
      right: key('KeyD'),
      up: key('KeyW'),
      down: key('KeyS'),
    });
    expect(map.get('Move')?.bindings.map((b) => b.role)).toEqual([
      'negativeX',
      'positiveX',
      'positiveY',
      'negativeY',
    ]);
  });

  it('stick() records a single analogX binding to a gamepad axis', () => {
    const map = new ActionMap().stick('Throttle', gamepadAxis('RightTrigger'));
    const def = map.get('Throttle');
    expect(def?.kind).toBe('axis');
    expect(def?.bindings).toEqual([{ role: 'analogX', device: 'gamepad', code: 'RightTrigger' }]);
  });

  it('stick2d() records analogX + analogY bindings', () => {
    const map = new ActionMap().stick2d('Move', {
      x: gamepadAxis('LeftStickX'),
      y: gamepadAxis('LeftStickY'),
    });
    expect(map.get('Move')?.bindings.map((b) => [b.role, b.code])).toEqual([
      ['analogX', 'LeftStickX'],
      ['analogY', 'LeftStickY'],
    ]);
  });

  it('axis()/axis2d() append analog bindings after the digital legs', () => {
    const move1 = new ActionMap().axis('MoveX', {
      negative: key('KeyA'),
      positive: key('KeyD'),
      analog: gamepadAxis('LeftStickX'),
    });
    expect(move1.get('MoveX')?.bindings.map((b) => b.role)).toEqual([
      'negativeX',
      'positiveX',
      'analogX',
    ]);

    const move2 = new ActionMap().axis2d('Move', {
      left: key('KeyA'),
      right: key('KeyD'),
      up: key('KeyW'),
      down: key('KeyS'),
      analog: { x: gamepadAxis('LeftStickX'), y: gamepadAxis('LeftStickY') },
    });
    expect(move2.get('Move')?.bindings.map((b) => b.role)).toEqual([
      'negativeX',
      'positiveX',
      'positiveY',
      'negativeY',
      'analogX',
      'analogY',
    ]);
  });
});

describe('resolveActionState — button', () => {
  it('tracks pressed / justPressed / justReleased across frames', () => {
    const h = harness(new ActionMap().button('Jump', key('Space')));

    h.keyboard.press('Space');
    h.resolve();
    expect(h.state.pressed('Jump')).toBe(true);
    expect(h.state.justPressed('Jump')).toBe(true);
    expect(h.state.value('Jump')).toBe(1);

    // Still held next frame → no longer just-pressed.
    h.resolve();
    expect(h.state.justPressed('Jump')).toBe(false);
    expect(h.state.pressed('Jump')).toBe(true);

    h.keyboard.release('Space');
    h.resolve();
    expect(h.state.pressed('Jump')).toBe(false);
    expect(h.state.justReleased('Jump')).toBe(true);
    expect(h.state.value('Jump')).toBe(0);
  });

  it('many-to-many: action stays held while any bound input is held', () => {
    const h = harness(new ActionMap().button('Fire', key('KeyF'), mouseButton('Left')));

    h.keyboard.press('KeyF');
    h.mouse.press('Left');
    h.resolve();
    expect(h.state.pressed('Fire')).toBe(true);

    // Release the key; mouse still held → still pressed, not released.
    h.keyboard.release('KeyF');
    h.resolve();
    expect(h.state.pressed('Fire')).toBe(true);
    expect(h.state.justReleased('Fire')).toBe(false);

    // Release the last input → released this frame.
    h.mouse.release('Left');
    h.resolve();
    expect(h.state.pressed('Fire')).toBe(false);
    expect(h.state.justReleased('Fire')).toBe(true);
  });
});

describe('resolveActionState — axis', () => {
  it('positive − negative, both cancels', () => {
    const h = harness(new ActionMap().axis('MoveX', { negative: key('KeyA'), positive: key('KeyD') }));

    h.keyboard.press('KeyD');
    h.resolve();
    expect(h.state.axis('MoveX')).toBe(1);

    h.keyboard.press('KeyA');
    h.resolve();
    expect(h.state.axis('MoveX')).toBe(0);

    h.keyboard.release('KeyD');
    h.resolve();
    expect(h.state.axis('MoveX')).toBe(-1);
  });
});

describe('resolveActionState — axis2d', () => {
  it('composes a virtual D-pad vector; +y is up', () => {
    const h = harness(
      new ActionMap().axis2d('Move', {
        left: key('KeyA'),
        right: key('KeyD'),
        up: key('KeyW'),
        down: key('KeyS'),
      }),
    );

    h.keyboard.press('KeyW');
    h.resolve();
    expect(h.state.axis2d('Move')).toEqual({ x: 0, y: 1 });

    h.keyboard.press('KeyD');
    h.resolve();
    expect(h.state.axis2d('Move')).toEqual({ x: 1, y: 1 });
    expect(h.state.pressed('Move')).toBe(true);
    expect(h.state.value('Move')).toBeCloseTo(Math.SQRT2, 5);
  });

  it('unknown action reads zero', () => {
    const h = harness(new ActionMap());
    h.resolve();
    expect(h.state.value('Nope')).toBe(0);
    expect(h.state.axis2d('Nope')).toEqual({ x: 0, y: 0 });
  });

  it('resolves a button action from a gamepad-button binding', () => {
    const h = harness(new ActionMap().button('Jump', gamepadButton('South')));
    h.resolve();
    expect(h.state.pressed('Jump')).toBe(false);

    h.gamepad.press('South');
    h.resolve();
    expect(h.state.pressed('Jump')).toBe(true);
    expect(h.state.justPressed('Jump')).toBe(true);

    h.gamepad.release('South');
    h.resolve();
    expect(h.state.pressed('Jump')).toBe(false);
  });

  it('mixes gamepad + keyboard on one action (OR-ed)', () => {
    const h = harness(new ActionMap().button('Fire', key('KeyF'), gamepadButton('RightTrigger')));
    h.gamepad.press('RightTrigger');
    h.resolve();
    expect(h.state.pressed('Fire')).toBe(true);
    h.gamepad.release('RightTrigger');
    h.resolve();
    expect(h.state.pressed('Fire')).toBe(false);
  });

  it('drives a virtual D-pad axis2d from gamepad buttons', () => {
    const h = harness(
      new ActionMap().axis2d('Move', {
        left: gamepadButton('DPadLeft'),
        right: gamepadButton('DPadRight'),
        up: gamepadButton('DPadUp'),
        down: gamepadButton('DPadDown'),
      }),
    );
    h.gamepad.press('DPadRight');
    h.gamepad.press('DPadUp');
    h.resolve();
    expect(h.state.axis2d('Move')).toEqual({ x: 1, y: 1 });
  });
});

describe('resolveActionState — analog axes', () => {
  it('stick() reads the analog axis value directly (partial deflection)', () => {
    const h = harness(new ActionMap().stick('Throttle', gamepadAxis('RightTrigger')));
    h.axes.set('RightTrigger', 0.4);
    h.resolve();
    expect(h.state.axis('Throttle')).toBeCloseTo(0.4, 5);
    expect(h.state.pressed('Throttle')).toBe(true);
  });

  it('stick2d() reads both axes as the { x, y }', () => {
    const h = harness(
      new ActionMap().stick2d('Move', { x: gamepadAxis('LeftStickX'), y: gamepadAxis('LeftStickY') }),
    );
    h.axes.set('LeftStickX', -0.5);
    h.axes.set('LeftStickY', 0.75);
    h.resolve();
    const move = h.state.axis2d('Move');
    expect(move.x).toBeCloseTo(-0.5, 5);
    expect(move.y).toBeCloseTo(0.75, 5);
  });

  it('combines keyboard + stick by larger magnitude', () => {
    const h = harness(
      new ActionMap().axis('MoveX', {
        negative: key('KeyA'),
        positive: key('KeyD'),
        analog: gamepadAxis('LeftStickX'),
      }),
    );

    // Stick alone → its value.
    h.axes.set('LeftStickX', 0.3);
    h.resolve();
    expect(h.state.axis('MoveX')).toBeCloseTo(0.3, 5);

    // Key fully pressed (±1) beats a partial stick → 1.
    h.keyboard.press('KeyD');
    h.resolve();
    expect(h.state.axis('MoveX')).toBe(1);

    // Key released, stick pushed the other way → the stick wins.
    h.keyboard.release('KeyD');
    h.axes.set('LeftStickX', -0.8);
    h.resolve();
    expect(h.state.axis('MoveX')).toBeCloseTo(-0.8, 5);
  });

  it('a dead-zoned (zero) stick leaves the digital legs in charge', () => {
    const h = harness(
      new ActionMap().axis2d('Move', {
        left: key('KeyA'),
        right: key('KeyD'),
        up: key('KeyW'),
        down: key('KeyS'),
        analog: { x: gamepadAxis('LeftStickX'), y: gamepadAxis('LeftStickY') },
      }),
    );
    // Stick resting at 0 (dead zone); keyboard drives up.
    h.keyboard.press('KeyW');
    h.resolve();
    expect(h.state.axis2d('Move')).toEqual({ x: 0, y: 1 });
  });
});
