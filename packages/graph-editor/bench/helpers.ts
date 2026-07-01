// Shared bench fixtures for @retro-engine/graph-editor. See docs/adr/ADR-0017
// for the benchmarking methodology. Bench files are excluded from the shipped
// build, so referencing an ADR here is fine.

import { addNode, connect } from '../src/ops';
import { createGraphDocument, type GraphDocument } from '../src/document';

/**
 * Build an `n`-node grid graph wired left-to-right in rows — a representative
 * dense document for render/pick/serialize benches. Each node connects its `out`
 * pin to the next node in its row.
 */
export const makeGridGraph = (n: number, cols = 20): GraphDocument => {
  const doc = createGraphDocument({ kindId: 'dataflow', guid: 'bench-graph' });
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const node = addNode(doc, { typeId: 'Op', pos: [col * 220, row * 140] });
    ids.push(node.id);
    if (col > 0) connect(doc, { node: ids[i - 1]!, pin: 'out' }, { node: node.id, pin: 'a' });
  }
  return doc;
};
