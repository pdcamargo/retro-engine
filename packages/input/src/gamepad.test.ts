import { describe, expect, it } from 'bun:test';

import { resolveActionState } from './action-resolve';
import { ActionState } from './action-state';
import { ActionMap, gamepadAxis } from './action-types';
import { ButtonInput } from './button-input';
import { applyDeadZone, Gamepads, updateGamepads } from './gamepad';
import type { GamepadAxis, GamepadButton } from './gamepad-mapping';
import { LEFT_TRIGGER_BUTTON, RIGHT_TRIGGER_BUTTON, STANDARD_BUTTONS } from './gamepad-mapping';
import type { GamepadSnapshot, GamepadSource } from './gamepad-source';

class StubSource implements GamepadSource {
  snapshots: readonly GamepadSnapshot[] = [];
  poll(): readonly GamepadSnapshot[] {
    return this.snapshots;
  }
}

const std = (
  index: number,
  opts: { press?: GamepadButton[]; axes?: number[]; triggers?: [number, number] } = {},
): GamepadSnapshot => {
  const pressed = new Set(opts.press ?? []);
  const buttons = STANDARD_BUTTONS.map((name, i) => {
    let value = pressed.has(name) ? 1 : 0;
    if (opts.triggers) {
      if (i === LEFT_TRIGGER_BUTTON) value = opts.triggers[0];
      if (i === RIGHT_TRIGGER_BUTTON) value = opts.triggers[1];
    }
    return { pressed: pressed.has(name) || value > 0, value };
  });
  return { index, id: `pad${index}`, mapping: 'standard', connected: true, buttons, axes: opts.axes ?? [0, 0, 0, 0] };
};

describe('applyDeadZone', () => {
  it('zeroes below the dead zone', () => {
    expect(applyDeadZone(0.05, 0.1)).toBe(0);
    expect(applyDeadZone(-0.09, 0.1)).toBe(0);
  });

  it('rescales above the dead zone, preserving sign', () => {
    // At exactly 1 → 1; halfway between dz and 1 → 0.5.
    expect(applyDeadZone(1, 0.1)).toBeCloseTo(1, 5);
    expect(applyDeadZone(0.55, 0.1)).toBeCloseTo(0.5, 5);
    expect(applyDeadZone(-1, 0.2)).toBeCloseTo(-1, 5);
  });
});

describe('updateGamepads — connect + read', () => {
  it('creates a pad on first poll and reflects its buttons/axes', () => {
    const pads = new Gamepads();
    pads.deadZone = 0; // isolate pass-through + Y-flip from dead-zone rescaling
    const src = new StubSource();
    src.snapshots = [std(0, { press: ['South'], axes: [0.5, -0.5, 0, 0] })];
    updateGamepads(pads, src);

    const pad = pads.get(0);
    expect(pad?.connected).toBe(true);
    expect(pad?.buttons.pressed('South')).toBe(true);
    expect(pad?.buttons.justPressed('South')).toBe(true);
    // Left stick X passes through; Y is flipped so up (negative raw) reads +.
    expect(pad?.axes.getOrZero('LeftStickX')).toBeCloseTo(0.5, 5);
    expect(pad?.axes.getOrZero('LeftStickY')).toBeCloseTo(0.5, 5);
  });

  it('tracks button edges across polls', () => {
    const pads = new Gamepads();
    const src = new StubSource();

    src.snapshots = [std(0, { press: ['South'] })];
    updateGamepads(pads, src);
    expect(pads.get(0)?.buttons.justPressed('South')).toBe(true);

    // Held again → no longer just-pressed.
    updateGamepads(pads, src);
    expect(pads.get(0)?.buttons.justPressed('South')).toBe(false);
    expect(pads.get(0)?.buttons.pressed('South')).toBe(true);

    // Released.
    src.snapshots = [std(0, {})];
    updateGamepads(pads, src);
    expect(pads.get(0)?.buttons.pressed('South')).toBe(false);
    expect(pads.get(0)?.buttons.justReleased('South')).toBe(true);
  });

  it('exposes trigger analog values as axes', () => {
    const pads = new Gamepads();
    const src = new StubSource();
    src.snapshots = [std(0, { triggers: [0.75, 0.25] })];
    updateGamepads(pads, src);
    expect(pads.get(0)?.axes.getOrZero('LeftTrigger')).toBeCloseTo(0.75, 5);
    expect(pads.get(0)?.axes.getOrZero('RightTrigger')).toBeCloseTo(0.25, 5);
    expect(pads.get(0)?.buttonValue('LeftTrigger')).toBeCloseTo(0.75, 5);
  });

  it('applies the dead zone to stick axes', () => {
    const pads = new Gamepads();
    pads.deadZone = 0.2;
    const src = new StubSource();
    src.snapshots = [std(0, { axes: [0.1, 0, 0, 0] })];
    updateGamepads(pads, src);
    expect(pads.get(0)?.axes.getOrZero('LeftStickX')).toBe(0);
  });
});

describe('updateGamepads — disconnect', () => {
  it('marks a vanished pad disconnected, releasing its buttons for one frame', () => {
    const pads = new Gamepads();
    const src = new StubSource();
    src.snapshots = [std(0, { press: ['South'] })];
    updateGamepads(pads, src);

    // Pad gone from the poll.
    src.snapshots = [];
    updateGamepads(pads, src);
    const pad = pads.get(0);
    expect(pad?.connected).toBe(false);
    expect(pad?.buttons.pressed('South')).toBe(false);
    expect(pad?.buttons.justReleased('South')).toBe(true);

    // Next frame the just-released edge is cleared and stays cleared.
    updateGamepads(pads, src);
    expect(pad?.buttons.justReleased('South')).toBe(false);
  });
});

describe('updateGamepads — non-standard mapping', () => {
  it('leaves named buttons empty but exposes raw indices', () => {
    const pads = new Gamepads();
    const src = new StubSource();
    src.snapshots = [
      {
        index: 0,
        id: 'weird',
        mapping: '',
        connected: true,
        buttons: [
          { pressed: true, value: 1 },
          { pressed: false, value: 0 },
        ],
        axes: [0.42, -0.3],
      },
    ];
    updateGamepads(pads, src);
    const pad = pads.get(0)!;
    expect(pad.buttons.pressed('South')).toBe(false); // not mapped
    expect(pad.buttonAt(0)).toBe(true);
    expect(pad.buttonAt(1)).toBe(false);
    expect(pad.axisAt(0)).toBeCloseTo(0.42, 5);
    expect(pad.axisAt(1)).toBeCloseTo(-0.3, 5);
  });
});

describe('Gamepads — multi-pad', () => {
  it('first() and connectedIndices() reflect connected pads', () => {
    const pads = new Gamepads();
    const src = new StubSource();
    src.snapshots = [std(1), std(0)];
    updateGamepads(pads, src);
    expect(pads.connectedIndices()).toEqual([0, 1]);
    expect(pads.first()?.index).toBe(0);

    // Disconnect pad 0 → first() falls through to pad 1.
    src.snapshots = [std(1)];
    updateGamepads(pads, src);
    expect(pads.connectedIndices()).toEqual([1]);
    expect(pads.first()?.index).toBe(1);
  });
});

describe('analog stick → action value (full data path)', () => {
  // Reproduces InputPlugin's action-update wiring: poll the source, then build
  // the same `gamepadAxes` query it hands the resolver from the first pad's
  // dead-zoned axes. Verifies snapshot → dead zone → Y-flip → axis value.
  const resolveFromPad = (map: ActionMap, state: ActionState, pads: Gamepads): void => {
    const pad = pads.first();
    resolveActionState(map, state, {
      keyboard: new ButtonInput(),
      mouse: new ButtonInput(),
      gamepad: { pressed: (b: GamepadButton) => pad?.buttons.pressed(b) ?? false },
      gamepadAxes: { value: (a: GamepadAxis) => pad?.axes.getOrZero(a) ?? 0 },
    });
  };

  it('drives a stick2d Move from raw stick axes (dead-zoned, Y up = +1)', () => {
    const pads = new Gamepads();
    const src = new StubSource();
    // Raw axes: X = 0.55 (→ ~0.5 after 0.1 dead zone), Y = -0.55 (API up is
    // negative → flips to +0.55 raw → ~+0.5 after dead zone).
    src.snapshots = [std(0, { axes: [0.55, -0.55, 0, 0] })];
    updateGamepads(pads, src);

    const map = new ActionMap().stick2d('Move', {
      x: gamepadAxis('LeftStickX'),
      y: gamepadAxis('LeftStickY'),
    });
    const state = new ActionState();
    resolveFromPad(map, state, pads);

    const move = state.axis2d('Move');
    expect(move.x).toBeCloseTo(0.5, 5);
    expect(move.y).toBeCloseTo(0.5, 5); // up is +1
    expect(state.pressed('Move')).toBe(true);
  });

  it('a resting stick (within the dead zone) resolves to zero', () => {
    const pads = new Gamepads();
    const src = new StubSource();
    src.snapshots = [std(0, { axes: [0.05, -0.05, 0, 0] })];
    updateGamepads(pads, src);

    const map = new ActionMap().stick('MoveX', gamepadAxis('LeftStickX'));
    const state = new ActionState();
    resolveFromPad(map, state, pads);

    expect(state.axis('MoveX')).toBe(0);
    expect(state.pressed('MoveX')).toBe(false);
  });
});
