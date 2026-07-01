/**
 * Undo integration: graph-document mutations recorded on the editor `History` as
 * snapshot-commands (ADR-0139). `apply`/`revert` restore structural clones of the
 * document's collections, giving whole-state undo/redo with stable ids without
 * requiring the document to be an `AssetServer` asset. Shared by the interaction
 * layer (direct manipulation) and the MCP command layer.
 */

import type { CustomCommand, History } from '@retro-engine/editor-sdk';

import type { GraphDocument } from './document';

/** A structural clone of the mutable collections of a document. */
export type DocSnapshot = Pick<
  GraphDocument,
  'nodes' | 'edges' | 'reroutes' | 'groups' | 'nodeOrder' | 'counters'
>;

/** Take a structural snapshot of a document's collections. */
export const snapshotDoc = (doc: GraphDocument): DocSnapshot =>
  structuredClone({
    nodes: doc.nodes,
    edges: doc.edges,
    reroutes: doc.reroutes,
    groups: doc.groups,
    nodeOrder: doc.nodeOrder,
    counters: doc.counters,
  });

/** Replace a document's collections from a snapshot, in place (identity preserved). */
export const restoreDoc = (doc: GraphDocument, s: DocSnapshot): void => {
  doc.nodes = s.nodes;
  doc.edges = s.edges;
  doc.reroutes = s.reroutes;
  doc.groups = s.groups;
  doc.nodeOrder = s.nodeOrder;
  doc.counters = s.counters;
};

/** Build an undoable command that restores `after` on apply and `before` on revert. */
export const snapshotCommand = (
  doc: GraphDocument,
  label: string,
  before: DocSnapshot,
  after: DocSnapshot,
): CustomCommand => ({
  kind: 'custom',
  entity: 0 as CustomCommand['entity'],
  componentName: '',
  label,
  apply: () => restoreDoc(doc, structuredClone(after)),
  revert: () => restoreDoc(doc, structuredClone(before)),
});

/**
 * Run a document mutation and record it on `history` as an undoable
 * snapshot-command. Returns the mutation's result. Use for discrete edits; drags
 * use {@link snapshotDoc} + {@link snapshotCommand} directly around the gesture.
 */
export const recordGraphEdit = <T>(history: History, doc: GraphDocument, label: string, mutate: () => T): T => {
  const before = snapshotDoc(doc);
  const result = mutate();
  history.apply(snapshotCommand(doc, label, before, snapshotDoc(doc)));
  return result;
};
