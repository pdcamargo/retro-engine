import { describe, expect, it } from 'bun:test';

import { AnimationClips, AnimationController, type Motion } from '@retro-engine/engine';

import { AC_NODE } from './ac-graph-kind';
import {
  ANY_STATE_NODE_ID,
  ENTRY_NODE_ID,
  buildBlendTreeDoc,
  buildStateMachineDoc,
  extractStateLayout,
  motionAtPath,
  motionTag,
  stateNodeId,
  stateNodeType,
  transitionBadge,
} from './ac-codec';

const clips = new AnimationClips();
const clipMotion = (): Motion => ({ kind: 'clip', clip: clips.add({ tracks: [], duration: 1 } as never) });

const nestedLocomotion = (): Motion => ({
  kind: 'blend2d',
  mode: 'freeformDirectional',
  parameterX: 'moveX',
  parameterY: 'moveY',
  children: [
    { motion: { kind: 'blend1d', parameter: 'speed', children: [{ motion: clipMotion(), threshold: 0 }] }, x: 1, y: 0 },
  ],
});

describe('ac-codec — motion tags + node types', () => {
  it('picks a state node type per motion kind', () => {
    expect(stateNodeType(clipMotion())).toBe(AC_NODE.stateClip);
    expect(stateNodeType({ kind: 'blend1d', parameter: 'speed', children: [] })).toBe(AC_NODE.stateBlend1d);
    expect(stateNodeType(nestedLocomotion())).toBe(AC_NODE.stateBlend2d);
  });

  it('tags nested blend trees', () => {
    expect(motionTag(clipMotion())).toBe('Clip');
    expect(motionTag({ kind: 'blend1d', parameter: 'speed', children: [{ motion: clipMotion(), threshold: 0 }] })).toBe('1D');
    expect(motionTag(nestedLocomotion())).toBe('2D · nested');
  });

  it('reads the salient transition badge', () => {
    expect(transitionBadge({ from: 0, to: 1, conditions: [{ parameter: 'jump', op: 'trigger', value: 0 }], duration: 0.1, hasExitTime: false, exitTime: 0 })).toBe('T');
    expect(transitionBadge({ from: 0, to: 1, conditions: [], duration: 0.1, hasExitTime: true, exitTime: 0.9 })).toBe('E');
    expect(transitionBadge({ from: 0, to: 1, conditions: [{ parameter: 'speed', op: 'gt', value: 0.1 }], duration: 0.1, hasExitTime: false, exitTime: 0 })).toBe('·');
    expect(transitionBadge({ from: 0, to: 1, conditions: [], duration: 0.1, hasExitTime: false, exitTime: 0 })).toBe('');
  });
});

describe('ac-codec — state machine document', () => {
  const controller = new AnimationController(
    [{ name: 'speed', type: 'float', default: 0 }],
    [
      { name: 'Idle', motion: clipMotion() },
      { name: 'Locomotion', motion: nestedLocomotion() },
    ],
    [
      { from: 0, to: 1, conditions: [{ parameter: 'speed', op: 'gt', value: 0.1 }], duration: 0.15, hasExitTime: false, exitTime: 0 },
      { from: -1, to: 0, conditions: [], duration: 0.1, hasExitTime: false, exitTime: 0 },
    ],
    0,
    'loco',
  );

  it('places pseudo-nodes, typed state nodes, and transition edges', () => {
    const { doc, edgeTransition } = buildStateMachineDoc(controller, 'guid-1');

    expect(doc.nodes[ENTRY_NODE_ID]?.typeId).toBe(AC_NODE.entry);
    expect(doc.nodes[ANY_STATE_NODE_ID]?.typeId).toBe(AC_NODE.anyState);
    expect(doc.nodes[stateNodeId(0)]?.typeId).toBe(AC_NODE.stateClip);
    expect(doc.nodes[stateNodeId(0)]?.title).toBe('Idle');
    expect(doc.nodes[stateNodeId(1)]?.typeId).toBe(AC_NODE.stateBlend2d);

    // Entry→default + two transitions, all transition-styled.
    const edges = Object.values(doc.edges);
    expect(edges).toHaveLength(3);
    expect(edges.every((e) => e.style === 'transition')).toBe(true);

    // The any-state transition sources the Any-State pseudo-node.
    const anyEdge = edges.find((e) => e.from.node === ANY_STATE_NODE_ID);
    expect(anyEdge?.to.node).toBe(stateNodeId(0));

    // Edge→transition mapping covers both real transitions (not the Entry edge).
    expect([...edgeTransition.values()].sort()).toEqual([0, 1]);
  });

  it('builds a blend-tree doc: root with per-child output pins wired to child nodes', () => {
    // State 1 (Locomotion) is a 2D blend with one 1D sub-tree child.
    const doc = buildBlendTreeDoc(controller, 'g::bt::1:', 1, []);
    expect(doc.nodes['blendroot']?.typeId).toBe(AC_NODE.blendRoot);
    // The root carries one output pin per child (per-instance pins).
    expect(doc.nodes['blendroot']?.outputs).toHaveLength(1);
    expect(doc.nodes['blendroot']?.outputs?.[0]?.label).toBe('1D Blend Tree');
    // Child node is a sub-tree, wired from the root's c0 pin.
    expect(doc.nodes['child:0']?.typeId).toBe(AC_NODE.subTreeChild);
    const edges = Object.values(doc.edges);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ from: { node: 'blendroot', pin: 'c0' }, to: { node: 'child:0', pin: 'in' } });
  });

  it('descends via path: the nested 1D tree resolves to a clip child', () => {
    const nested = motionAtPath(controller.states[1]!.motion, [0]);
    expect(nested?.kind).toBe('blend1d');
    const doc = buildBlendTreeDoc(controller, 'g::bt::1:0', 1, [0]);
    expect(doc.nodes['child:0']?.typeId).toBe(AC_NODE.clipChild);
  });

  it('round-trips layout by state name', () => {
    const { doc } = buildStateMachineDoc(controller, 'guid-1');
    doc.nodes[stateNodeId(1)]!.pos = [999, 123];
    doc.nodes[ENTRY_NODE_ID]!.pos = [5, 6];

    const layout = extractStateLayout(doc, controller);
    expect(layout.states?.['Locomotion']).toEqual([999, 123]);
    expect(layout.entry).toEqual([5, 6]);

    // Rebuilding with the saved layout restores the moved position.
    const rebuilt = buildStateMachineDoc(controller, 'guid-1', layout).doc;
    expect(rebuilt.nodes[stateNodeId(1)]?.pos).toEqual([999, 123]);
  });
});
