// Maps a live `AnimationController` onto a graph-editor `GraphDocument` (and back
// for layout), per the domain-authoritative architecture: the controller is the
// source of truth; the document is the interaction/render surface the toolkit
// draws. State-node positions are pure editor layout, persisted in the asset's
// `.meta` sidecar (see `ac-layout.ts`) and folded back in when the doc is rebuilt.

import type { AnimationController, Motion, Transition } from '@retro-engine/engine';
import {
  connect,
  createGraphDocument,
  type EdgeId,
  type GraphDocument,
  addNode,
} from '@retro-engine/graph-editor';

import { AC_BLEND_TREE_KIND, AC_NODE, AC_STATE_MACHINE_KIND } from './ac-graph-kind';

/** Stable node id for state `index` in the state-machine document. */
export const stateNodeId = (index: number): string => `state:${index}`;
/** Stable node id for the Entry pseudo-node. */
export const ENTRY_NODE_ID = 'entry';
/** Stable node id for the Any-State pseudo-node. */
export const ANY_STATE_NODE_ID = 'any';

/**
 * Per-controller editor layout: state-node positions keyed by state name (stable
 * across reorders) plus the two pseudo-node positions. Persisted in the sidecar;
 * absent entries fall back to a deterministic auto-layout.
 */
export interface AcLayout {
  readonly version: 1;
  states?: Record<string, [number, number]>;
  entry?: [number, number];
  anyState?: [number, number];
}

/** The node-type id for a state, chosen so the header accent reads its motion kind. */
export const stateNodeType = (motion: Motion): string =>
  motion.kind === 'clip'
    ? AC_NODE.stateClip
    : motion.kind === 'blend1d'
      ? AC_NODE.stateBlend1d
      : AC_NODE.stateBlend2d;

/** Whether any child of a blend tree is itself a blend tree (a nested motion). */
const isNested = (motion: Motion): boolean =>
  motion.kind !== 'clip' && motion.children.some((c) => c.motion.kind !== 'clip');

/** The short motion tag shown on a state node (`Clip` / `1D` / `2D`, `· nested`). */
export const motionTag = (motion: Motion): string => {
  if (motion.kind === 'clip') return 'Clip';
  const base = motion.kind === 'blend1d' ? '1D' : '2D';
  return isNested(motion) ? `${base} · nested` : base;
};

/** The midpoint glyph for a transition: trigger, exit-time, condition, or none. */
export const transitionBadge = (t: Transition): string => {
  if (t.conditions.some((c) => c.op === 'trigger')) return 'T';
  if (t.hasExitTime) return 'E';
  if (t.conditions.length > 0) return '·';
  return '';
};

// Deterministic grid so a controller with no saved layout still reads cleanly:
// pseudo-nodes down the left gutter, states in columns to their right.
const autoStatePos = (index: number): [number, number] => [280 + Math.floor(index / 3) * 220, 40 + (index % 3) * 140];

/** What {@link buildStateMachineDoc} returns: the document plus edge→transition mapping. */
export interface StateMachineDoc {
  readonly doc: GraphDocument;
  /** Maps a transition edge id to its index in `controller.transitions` (the Entry edge is absent). */
  readonly edgeTransition: Map<EdgeId, number>;
}

/**
 * Build the state-machine {@link GraphDocument} for a controller: one node per
 * state (typed by its motion), the Entry and Any-State pseudo-nodes, and one
 * `'transition'`-styled edge per transition (plus the Entry→default edge). Node
 * positions come from `layout`, falling back to the deterministic auto-layout.
 */
export const buildStateMachineDoc = (
  controller: AnimationController,
  guid: string,
  layout?: AcLayout,
): StateMachineDoc => {
  const doc = createGraphDocument({ kindId: AC_STATE_MACHINE_KIND, guid });
  const edgeTransition = new Map<EdgeId, number>();

  addNode(doc, { id: ENTRY_NODE_ID, typeId: AC_NODE.entry, pos: layout?.entry ?? [40, 40], title: 'Entry' });
  addNode(doc, { id: ANY_STATE_NODE_ID, typeId: AC_NODE.anyState, pos: layout?.anyState ?? [40, 220], title: 'Any State' });

  controller.states.forEach((state, i) => {
    addNode(doc, {
      id: stateNodeId(i),
      typeId: stateNodeType(state.motion),
      pos: layout?.states?.[state.name] ?? autoStatePos(i),
      title: state.name,
    });
  });

  // Entry wires to the default/entry state (green, no badge).
  if (controller.states.length > 0 && controller.defaultState < controller.states.length) {
    const e = connect(doc, { node: ENTRY_NODE_ID, pin: '' }, { node: stateNodeId(controller.defaultState), pin: '' });
    if (e !== undefined) e.style = 'transition';
  }

  controller.transitions.forEach((t, k) => {
    const fromNode = t.from === -1 ? ANY_STATE_NODE_ID : stateNodeId(t.from);
    if (doc.nodes[fromNode] === undefined || doc.nodes[stateNodeId(t.to)] === undefined) return;
    const e = connect(doc, { node: fromNode, pin: '' }, { node: stateNodeId(t.to), pin: '' });
    if (e === undefined) return;
    e.style = 'transition';
    const badge = transitionBadge(t);
    if (badge !== '') e.label = badge;
    edgeTransition.set(e.id, k);
  });

  return { doc, edgeTransition };
};

// ---- Blend-tree view -------------------------------------------------------

/** Walk a state's root motion down a child-index `path`; `undefined` if the path is invalid. */
export const motionAtPath = (root: Motion, path: readonly number[]): Motion | undefined => {
  let m: Motion = root;
  for (const idx of path) {
    if (m.kind === 'clip') return undefined;
    const child = m.children[idx]?.motion;
    if (child === undefined) return undefined;
    m = child;
  }
  return m;
};

/** A short label for a motion used on blend-tree pins/nodes/breadcrumbs. */
export const motionChildLabel = (motion: Motion, index: number): string => {
  if (motion.kind !== 'clip' && motion.name !== undefined && motion.name !== '') return motion.name;
  return motion.kind === 'clip' ? `Clip ${index + 1}` : motion.kind === 'blend1d' ? '1D Blend Tree' : '2D Blend Tree';
};

/** Stable document GUID for a blend tree at (state, path) within a controller. */
export const blendTreeDocGuid = (controllerGuid: string, state: number, path: readonly number[]): string =>
  `${controllerGuid}::bt::${state}:${path.join('.')}`;

/**
 * Build the blend-tree {@link GraphDocument} for the motion at (state, path): a
 * root node carrying one weight output pin per child (per-instance pins), each
 * wired to a child node (a clip leaf or a nested sub-tree). Auto-laid-out — root
 * on the left, children stacked on the right. Empty when the path is not a blend.
 */
export const buildBlendTreeDoc = (
  controller: AnimationController,
  guid: string,
  state: number,
  path: readonly number[],
): GraphDocument => {
  const doc = createGraphDocument({ kindId: AC_BLEND_TREE_KIND, guid });
  const rootMotion = controller.states[state]?.motion;
  const motion = rootMotion !== undefined ? motionAtPath(rootMotion, path) : undefined;
  if (motion === undefined || motion.kind === 'clip') return doc;

  const outputs = motion.children.map((ch, i) => ({ name: `c${i}`, type: 'float', label: motionChildLabel(ch.motion, i) }));
  const root = addNode(doc, { id: 'blendroot', typeId: AC_NODE.blendRoot, pos: [40, 40], title: 'Blend Tree' });
  root.outputs = outputs;

  motion.children.forEach((ch, i) => {
    const isClip = ch.motion.kind === 'clip';
    addNode(doc, {
      id: `child:${i}`,
      typeId: isClip ? AC_NODE.clipChild : AC_NODE.subTreeChild,
      pos: [360, 40 + i * 84],
      title: motionChildLabel(ch.motion, i),
    });
    connect(doc, { node: 'blendroot', pin: `c${i}` }, { node: `child:${i}`, pin: 'in' });
  });
  return doc;
};

/**
 * Read the current node positions back out of a state-machine document into an
 * {@link AcLayout}, for persisting to the sidecar after the user drags nodes.
 * Keyed by state name so a later reorder keeps positions attached to the state.
 */
export const extractStateLayout = (doc: GraphDocument, controller: AnimationController): AcLayout => {
  const states: Record<string, [number, number]> = {};
  controller.states.forEach((state, i) => {
    const node = doc.nodes[stateNodeId(i)];
    if (node !== undefined) states[state.name] = [node.pos[0], node.pos[1]];
  });
  const layout: AcLayout = { version: 1, states };
  const entry = doc.nodes[ENTRY_NODE_ID];
  if (entry !== undefined) layout.entry = [entry.pos[0], entry.pos[1]];
  const any = doc.nodes[ANY_STATE_NODE_ID];
  if (any !== undefined) layout.anyState = [any.pos[0], any.pos[1]];
  return layout;
};
