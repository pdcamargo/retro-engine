// The Animator's live editing session: the graph environment/host/view the
// canvas draws, plus the controller currently being authored and its derived
// state-machine document. The controller is the source of truth; `rebuild()`
// regenerates the document from it (folding in the saved layout) after any
// structural change. Mirrors the graph-demo's host/view ownership.

import { AnimationController } from '@retro-engine/engine';
import {
  type EdgeId,
  type GraphEnvironment,
  type GraphTheme,
  type GraphView,
  GraphHost,
  createGraphTheme,
  createGraphView,
} from '@retro-engine/graph-editor';

import { type AcLayout, blendTreeDocGuid, buildBlendTreeDoc, buildStateMachineDoc, extractStateLayout } from './ac-codec';
import { createAnimatorEnvironment } from './ac-graph-kind';

/** Which sidebar list the Animator shows (Unity-style, both inside the panel). */
export type SidebarTab = 'layers' | 'parameters';

/**
 * What the Animator currently has selected — published to the shared Inspector so
 * it renders the matching body (state / transition / parameter / layer / blend
 * node / mask). `layer` index `-1` is the implicit base layer; a `blendNode` path
 * is the child-index chain from the state's root motion (empty = the root itself).
 */
export type AnimatorSelection =
  | { readonly kind: 'parameter'; readonly index: number }
  | { readonly kind: 'state'; readonly index: number }
  | { readonly kind: 'anyState' }
  | { readonly kind: 'transition'; readonly index: number }
  | { readonly kind: 'layer'; readonly index: number }
  | { readonly kind: 'blendNode'; readonly state: number; readonly path: readonly number[] }
  | { readonly kind: 'mask'; readonly layer: number };

/** The Animator panel's mutable per-session state. */
export interface AnimatorSession {
  readonly env: GraphEnvironment;
  readonly host: GraphHost;
  readonly view: GraphView;
  readonly theme: GraphTheme;
  /** Re-arm auto-framing next frame (the Fit control / a freshly opened controller). */
  fitRequested: boolean;
  /** The controller being authored, or `null` when nothing is open. */
  controller: AnimationController | null;
  /** The open controller's asset GUID (the active document's id), or `null`. */
  guid: string | null;
  /** The open controller's manifest path (for `saveAsset`), or `null`. */
  location: string | null;
  /** Saved node layout for the open controller, from its sidecar. */
  layout: AcLayout | null;
  /** A double-clicked controller whose value is still loading; completed by `tickPendingOpen`. */
  pendingOpen?: { guid: string; location: string } | undefined;
  sidebarTab: SidebarTab;
  filter: string;
  /** Active document's transition-edge → transition-index map, refreshed on rebuild. */
  edgeTransition: Map<EdgeId, number>;
  /** Current selection, mirrored to the shared Inspector; `null` when nothing is selected. */
  selection: AnimatorSelection | null;
  /** Blend-tree descent path (state index + child-index chain); empty = the state machine. */
  breadcrumb: { readonly state: number; readonly path: readonly number[] } | null;
  /** Last graph node/edge selection keys, to detect canvas-driven selection changes. */
  lastNodeKey: string;
  lastEdgeKey: string;
  /** Inline-rename target in the sidebar list (double-click, or a freshly added row). */
  renaming: { kind: 'parameter' | 'layer'; index: number } | null;
  /** Working text for the inline rename; committed on Enter / focus-out. */
  renameBuffer: string;
  /** Set the frame a rename begins so the input grabs keyboard focus once. */
  renameFocus: boolean;
}

/**
 * Regenerate the active document from the controller: the state machine, or — when
 * a blend-tree breadcrumb is set — the blend tree at that (state, path). Closes any
 * previously open documents so the host holds only the active view.
 */
export const rebuildSession = (session: AnimatorSession): void => {
  if (session.controller === null || session.guid === null) return;
  // Regenerating the document invalidates the node ids the interaction state machine
  // may be mid-gesture on. Cancel any in-progress gesture so a held double-click that
  // triggered a descend doesn't carry into dragging a node on the freshly built graph
  // (nested blend trees reuse ids like `blendroot` / `child:0`).
  session.view.interaction = { k: 'idle' };
  session.view.pendingEdit = null;
  // Capture the user's node arrangement before regenerating, so a structural edit
  // doesn't snap the state machine back to the auto-layout.
  if (session.breadcrumb === null) {
    const existing = session.host.get(session.guid);
    if (existing !== undefined) session.layout = extractStateLayout(existing, session.controller);
  }
  for (const info of session.host.list()) session.host.close(info.guid);

  if (session.breadcrumb !== null) {
    const { state, path } = session.breadcrumb;
    const g = blendTreeDocGuid(session.guid, state, path);
    session.host.open(buildBlendTreeDoc(session.controller, g, state, path));
    session.host.setActive(g);
    session.edgeTransition = new Map();
    return;
  }

  const { doc, edgeTransition } = buildStateMachineDoc(session.controller, session.guid, session.layout ?? undefined);
  session.host.open(doc);
  session.host.setActive(doc.guid);
  session.edgeTransition = edgeTransition;
};

/** Drop the graph's node/edge/reroute/group highlight — the old doc's ids don't carry over. */
const clearGraphSelection = (session: AnimatorSession): void => {
  session.view.selection.clear();
  session.view.edgeSelection.clear();
  session.view.rerouteSelection.clear();
  session.view.groupSelection.clear();
};

/** Descend into (or navigate to) the blend tree at (state, path); rebuilds + frames it. */
export const enterBlendTree = (session: AnimatorSession, state: number, path: readonly number[]): void => {
  session.breadcrumb = { state, path };
  session.selection = { kind: 'blendNode', state, path };
  session.fitRequested = true;
  clearGraphSelection(session);
  rebuildSession(session);
};

/** Return to the state-machine canvas from a blend tree. */
export const exitToStateMachine = (session: AnimatorSession): void => {
  session.breadcrumb = null;
  session.selection = null;
  session.fitRequested = true;
  clearGraphSelection(session);
  rebuildSession(session);
};

/** Point the session at a controller (its GUID + optional saved layout) and rebuild. */
export const openController = (
  session: AnimatorSession,
  controller: AnimationController,
  guid: string,
  layout: AcLayout | null,
): void => {
  session.controller = controller;
  session.guid = guid;
  session.layout = layout;
  session.fitRequested = true;
  session.selection = null;
  session.breadcrumb = null;
  clearGraphSelection(session);
  rebuildSession(session);
};

/**
 * Create an empty Animator session. No controller is open until one is opened from
 * the asset browser or created there — the panel shows a "No controller open" state.
 */
export const createAnimatorSession = (): AnimatorSession => {
  const env = createAnimatorEnvironment();
  const session: AnimatorSession = {
    env,
    host: new GraphHost(env),
    view: createGraphView(),
    theme: createGraphTheme(),
    fitRequested: true,
    controller: null,
    guid: null,
    location: null,
    layout: null,
    sidebarTab: 'parameters',
    filter: '',
    edgeTransition: new Map(),
    selection: null,
    breadcrumb: null,
    lastNodeKey: '',
    lastEdgeKey: '',
    renaming: null,
    renameBuffer: '',
    renameFocus: false,
  };
  return session;
};
