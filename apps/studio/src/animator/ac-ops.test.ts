import { describe, expect, it } from 'bun:test';

import { AnimationController, type Motion } from '@retro-engine/engine';
import { asAssetIndex, makeHandle } from '@retro-engine/assets';

import {
  addBlendChild,
  addCondition,
  addParameter,
  addTransition,
  deleteParameter,
  deleteState,
  removeBlendChild,
  renameParameter,
  retypeParameter,
  setBlend2dMode,
  setChildThreshold,
  setDefaultState,
  setStateMotionKind,
  setStateSpeed,
  setTransitionField,
  uniqueName,
} from './ac-ops';

const clip = (): Motion => ({ kind: 'clip', clip: makeHandle(asAssetIndex(0)) });
const make = (): AnimationController =>
  new AnimationController(
    [{ name: 'speed', type: 'float', default: 0 }],
    [
      { name: 'Idle', motion: clip() },
      { name: 'Walk', motion: clip() },
      { name: 'Run', motion: clip() },
    ],
    [
      { from: 0, to: 1, conditions: [], duration: 0.1, hasExitTime: false, exitTime: 0 },
      { from: 1, to: 2, conditions: [], duration: 0.1, hasExitTime: false, exitTime: 0 },
      { from: 2, to: 0, conditions: [], duration: 0.1, hasExitTime: false, exitTime: 0 },
    ],
    0,
  );

describe('ac-ops — parameters', () => {
  it('adds unique names and re-types resetting the default', () => {
    const c = make();
    const p = addParameter(c, 'float');
    expect(p.name).toBe('Float');
    addParameter(c, 'float'); // "Float 2"
    expect(c.parameters.at(-1)!.name).toBe('Float 2');
    retypeParameter(c, c.parameters.length - 1, 'trigger');
    expect(c.parameters.at(-1)!.type).toBe('trigger');
    expect(c.parameters.at(-1)!.default).toBe(0);
  });

  it('rename repoints conditions and blend-tree params', () => {
    const c = make();
    c.states[1] = { name: 'Walk', motion: { kind: 'blend1d', parameter: 'speed', children: [{ motion: clip(), threshold: 0 }] } };
    addCondition(c, 0, 'speed');
    renameParameter(c, 0, 'moveSpeed');
    expect(c.parameters[0]!.name).toBe('moveSpeed');
    expect(c.transitions[0]!.conditions[0]!.parameter).toBe('moveSpeed');
    const m = c.states[1]!.motion;
    expect(m.kind === 'blend1d' && m.parameter).toBe('moveSpeed');
  });

  it('deletes a parameter', () => {
    const c = make();
    deleteParameter(c, 0);
    expect(c.parameters).toHaveLength(0);
  });
});

describe('ac-ops — states + transitions index maintenance', () => {
  it('deleting a state drops incident transitions and shifts higher indices', () => {
    const c = make();
    // Delete "Walk" (index 1): transitions 0→1 and 1→2 are incident and dropped;
    // transition 2→0 remains but "Run" shifts from index 2 to 1.
    deleteState(c, 1);
    expect(c.states.map((s) => s.name)).toEqual(['Idle', 'Run']);
    expect(c.transitions).toHaveLength(1);
    expect(c.transitions[0]).toMatchObject({ from: 1, to: 0 }); // Run(now 1) → Idle(0)
  });

  it('fixes defaultState when the default (or a higher state) is removed', () => {
    const c = make();
    c.defaultState = 2;
    deleteState(c, 1); // Run 2→1, default follows
    expect(c.defaultState).toBe(1);
    deleteState(c, 1); // remove the (now) default
    expect(c.defaultState).toBe(0);
  });

  it('keeps any-state transitions (from === -1) through a delete', () => {
    const c = make();
    addTransition(c, -1, 2); // Any → Run
    deleteState(c, 0); // Idle removed; Run shifts 2→1
    const any = c.transitions.find((t) => t.from === -1);
    expect(any?.to).toBe(1);
  });

  it('setStateSpeed omits speed when reset to 1', () => {
    const c = make();
    setStateSpeed(c, 0, 1.5);
    expect(c.states[0]!.speed).toBe(1.5);
    setStateSpeed(c, 0, 1);
    expect(c.states[0]!.speed).toBeUndefined();
  });

  it('addCondition picks an operator from the parameter type', () => {
    const c = make();
    c.parameters.push({ name: 'jump', type: 'trigger', default: 0 });
    const ti = addTransition(c, 0, 2);
    addCondition(c, ti, 'jump');
    expect(c.transitions[ti]!.conditions[0]).toMatchObject({ parameter: 'jump', op: 'trigger' });
    addCondition(c, ti, 'speed');
    expect(c.transitions[ti]!.conditions[1]).toMatchObject({ parameter: 'speed', op: 'gt' });
  });

  it('setTransitionField patches exit time', () => {
    const c = make();
    setTransitionField(c, 0, { hasExitTime: true, exitTime: 0.8 });
    expect(c.transitions[0]).toMatchObject({ hasExitTime: true, exitTime: 0.8 });
  });

  it('setDefaultState guards the range', () => {
    const c = make();
    setDefaultState(c, 5);
    expect(c.defaultState).toBe(0);
    setDefaultState(c, 2);
    expect(c.defaultState).toBe(2);
  });
});

describe('ac-ops — blend trees', () => {
  it('converts a state motion to a blend and adds/edits/removes children at a nested path', () => {
    const c = make();
    setStateMotionKind(c, 0, 'blend2d');
    expect(c.states[0]!.motion.kind).toBe('blend2d');

    // Add a sub-tree child at the root, then a clip inside that sub-tree (path [0]).
    addBlendChild(c, 0, [], true); // child 0 = 1D sub-tree
    addBlendChild(c, 0, [0], false); // clip inside the sub-tree
    const root = c.states[0]!.motion;
    expect(root.kind === 'blend2d' && root.children.length).toBe(1);
    const sub = root.kind === 'blend2d' ? root.children[0]!.motion : undefined;
    expect(sub?.kind).toBe('blend1d');
    expect(sub?.kind === 'blend1d' && sub.children.length).toBe(1);

    // Edit the nested clip's threshold.
    setChildThreshold(c, 0, [0], 0, 3.5);
    const root2 = c.states[0]!.motion;
    const sub2 = root2.kind === 'blend2d' ? root2.children[0]!.motion : undefined;
    expect(sub2?.kind === 'blend1d' && sub2.children[0]!.threshold).toBe(3.5);

    // Remove the root child.
    removeBlendChild(c, 0, [], 0);
    const root3 = c.states[0]!.motion;
    expect(root3.kind === 'blend2d' && root3.children.length).toBe(0);
  });

  it('sets a 2D blend mode', () => {
    const c = make();
    setStateMotionKind(c, 1, 'blend2d');
    setBlend2dMode(c, 1, [], 'simpleDirectional');
    const m = c.states[1]!.motion;
    expect(m.kind === 'blend2d' && m.mode).toBe('simpleDirectional');
  });
});

describe('ac-ops — uniqueName', () => {
  it('suffixes collisions', () => {
    expect(uniqueName('A', ['A', 'A 2'])).toBe('A 3');
    expect(uniqueName('B', ['A'])).toBe('B');
  });
});
