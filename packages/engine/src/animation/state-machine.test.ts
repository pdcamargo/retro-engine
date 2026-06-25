import { asAssetIndex, makeHandle } from '@retro-engine/assets';
import { describe, expect, it } from 'bun:test';

import type { AnimationClip } from './animation-clip';
import { AnimationController, type ControllerState, type Transition } from './animation-controller';
import {
  type ParameterAccess,
  createControllerRuntime,
  stateWeights,
  stepController,
} from './state-machine';

const dummyClip = () => ({ kind: 'clip' as const, clip: makeHandle<AnimationClip>(asAssetIndex(0)) });
const states = (...names: string[]): ControllerState[] =>
  names.map((name) => ({ name, motion: dummyClip() }));
const params = (m: Record<string, number>): ParameterAccess => ({
  get: (n) => m[n] ?? 0,
  reset: (n) => {
    m[n] = 0;
  },
});
const oneSecond = (): number => 1;

describe('stepController', () => {
  it('enters the default state and stays until a condition holds', () => {
    const ctrl = new AnimationController(
      [{ name: 'Speed', type: 'float', default: 0 }],
      states('Idle', 'Run'),
      [{ from: 0, to: 1, conditions: [{ parameter: 'Speed', op: 'gt', value: 0.5 }], duration: 0.5, hasExitTime: false, exitTime: 0 }],
      0,
    );
    const rt = createControllerRuntime(2);
    const p = params({ Speed: 0 });

    stepController(ctrl, rt, p, 0.1, oneSecond);
    expect(rt.currentState).toBe(0);
    expect(rt.fromState).toBe(-1);

    p.reset('Speed');
    const fast = params({ Speed: 1 });
    stepController(ctrl, rt, fast, 0.1, oneSecond);
    expect(rt.currentState).toBe(1);
    expect(rt.fromState).toBe(0); // crossfade in progress
  });

  it('respects exit time before firing', () => {
    const tr: Transition = {
      from: 0,
      to: 1,
      conditions: [],
      duration: 0,
      hasExitTime: true,
      exitTime: 0.5,
    };
    const ctrl = new AnimationController([], states('A', 'B'), [tr], 0);
    const rt = createControllerRuntime(2);
    const p = params({});

    stepController(ctrl, rt, p, 0.25, oneSecond); // phase 0.25 < 0.5
    expect(rt.currentState).toBe(0);
    stepController(ctrl, rt, p, 0.25, oneSecond); // phase 0.5 ≥ 0.5
    expect(rt.currentState).toBe(1);
  });

  it('consumes a trigger when its transition fires', () => {
    const ctrl = new AnimationController(
      [{ name: 'Jump', type: 'trigger', default: 0 }],
      states('Ground', 'Air'),
      [{ from: -1, to: 1, conditions: [{ parameter: 'Jump', op: 'trigger', value: 0 }], duration: 0, hasExitTime: false, exitTime: 0 }],
      0,
    );
    const rt = createControllerRuntime(2);
    const store: Record<string, number> = { Jump: 1 };
    const p = params(store);

    stepController(ctrl, rt, p, 0.1, oneSecond);
    expect(rt.currentState).toBe(1);
    expect(store.Jump).toBe(0); // trigger consumed
  });

  it('ramps cross-state weights over the transition duration', () => {
    const ctrl = new AnimationController(
      [{ name: 'Go', type: 'float', default: 0 }],
      states('A', 'B'),
      [{ from: 0, to: 1, conditions: [{ parameter: 'Go', op: 'gt', value: 0.5 }], duration: 0.5, hasExitTime: false, exitTime: 0 }],
      0,
    );
    const rt = createControllerRuntime(2);
    const p = params({ Go: 1 });

    stepController(ctrl, rt, p, 0.1, oneSecond); // fires; elapsed resets to 0
    expect(stateWeights(rt).current).toBeCloseTo(0, 5);

    stepController(ctrl, rt, p, 0.25, oneSecond); // elapsed 0.25 / 0.5
    expect(stateWeights(rt).current).toBeCloseTo(0.5, 5);
  });
});
