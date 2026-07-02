// The graph-editor vocabulary for Animation Controllers. The state machine and
// every blend tree render with the shared node/pin/wire/transition language by
// registering an `animation-controller` kind (state + blend-tree node types) and a
// blend-tree kind against a GraphEnvironment; the codec (`ac-codec.ts`) maps a
// live `AnimationController` to/from documents of these kinds.

import { createGraphEnvironment, type GraphEnvironment } from '@retro-engine/graph-editor';

/** Graph-kind id for the state-machine canvas (states + transitions). */
export const AC_STATE_MACHINE_KIND = 'animation-controller';
/** Graph-kind id for a blend-tree canvas (a root node wired to its children). */
export const AC_BLEND_TREE_KIND = 'animation-blend-tree';

/** Node-type ids the codec places. Deterministic so layout + selection are stable. */
export const AC_NODE = {
  entry: 'Entry',
  anyState: 'AnyState',
  stateClip: 'StateClip',
  stateBlend1d: 'StateBlend1d',
  stateBlend2d: 'StateBlend2d',
  blendRoot: 'BlendTreeRoot',
  clipChild: 'ClipChild',
  subTreeChild: 'SubTreeChild',
} as const;

/**
 * Build a {@link GraphEnvironment} carrying the Animation Controller kinds and
 * their node vocabularies. One environment backs the whole Animator (the state
 * machine plus every nested blend tree), shared with the MCP layer through a host.
 */
export const createAnimatorEnvironment = (): GraphEnvironment => {
  const env = createGraphEnvironment();

  // State machine: pseudo-nodes (Entry green, Any-State amber) + one state type per
  // motion kind so the header accent reads the motion type (clip violet, blend blue).
  const sm = env.registerKind({ id: AC_STATE_MACHINE_KIND, label: 'Animation Controller' });
  sm.nodeTypes
    .register({ type: AC_NODE.entry, category: 'input', style: 'state', icon: 'play', sub: 'entry' })
    .register({ type: AC_NODE.anyState, category: 'logic', style: 'state', icon: 'shuffle', sub: 'any state' })
    .register({ type: AC_NODE.stateClip, category: 'flow', style: 'state', icon: 'file', sub: 'clip' })
    .register({ type: AC_NODE.stateBlend1d, category: 'subgraph', style: 'state', icon: 'move-horizontal', sub: '1d blend' })
    .register({ type: AC_NODE.stateBlend2d, category: 'subgraph', style: 'state', icon: 'move', sub: '2d blend' });

  // Blend tree: a root node with one weight-carrying output pin per child, wired to
  // child nodes (a clip leaf, or a nested sub-tree that descends on double-click).
  // Pins use the `float` type so they render in the phosphor blend-tree color.
  const bt = env.registerKind({ id: AC_BLEND_TREE_KIND, label: 'Blend Tree' });
  bt.nodeTypes
    .register({ type: AC_NODE.blendRoot, category: 'subgraph', header: 'solid', icon: 'git-fork', sub: 'blend tree' })
    .register({
      type: AC_NODE.clipChild,
      category: 'flow',
      icon: 'file',
      sub: 'clip',
      inputs: [{ name: 'in', type: 'float' }],
    })
    .register({
      type: AC_NODE.subTreeChild,
      category: 'subgraph',
      icon: 'git-fork',
      sub: 'blend tree',
      inputs: [{ name: 'in', type: 'float' }],
    });

  return env;
};
