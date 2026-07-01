import { describe, expect, it } from 'bun:test';

import { createGraphDocument } from './document';
import {
  addGroup,
  addNode,
  addReroute,
  connect,
  disconnect,
  findEdge,
  incidentEdges,
  moveGroup,
  moveNode,
  raiseNode,
  removeGroup,
  removeNode,
  removeReroute,
  setFieldValue,
} from './ops';
import { deserializeGraph, GRAPH_FORMAT_VERSION, serializeGraph } from './serialize';

const doc3 = () => {
  const doc = createGraphDocument({ kindId: 'dataflow', guid: 'fixed-guid' });
  const a = addNode(doc, { typeId: 'Param', pos: [0, 0] });
  const b = addNode(doc, { typeId: 'Multiply', pos: [200, 40] });
  const c = addNode(doc, { typeId: 'Output', pos: [400, 0] });
  return { doc, a, b, c };
};

describe('ops', () => {
  it('mints unique ids and tracks z-order', () => {
    const { doc, a, b, c } = doc3();
    expect([a.id, b.id, c.id]).toEqual(['n1', 'n2', 'n3']);
    expect(doc.nodeOrder).toEqual(['n1', 'n2', 'n3']);
    raiseNode(doc, a.id);
    expect(doc.nodeOrder).toEqual(['n2', 'n3', 'n1']);
  });

  it('connects pins, rejecting self-links and duplicates', () => {
    const { doc, a, b } = doc3();
    const e = connect(doc, { node: a.id, pin: 'out' }, { node: b.id, pin: 'a' });
    expect(e).toBeDefined();
    expect(connect(doc, { node: a.id, pin: 'out' }, { node: b.id, pin: 'a' })).toBeUndefined();
    expect(connect(doc, { node: a.id, pin: 'out' }, { node: a.id, pin: 'a' })).toBeUndefined();
    expect(findEdge(doc, { node: a.id, pin: 'out' }, { node: b.id, pin: 'a' })).toBe(e!);
  });

  it('removes a node and cascades to its edges and reroutes', () => {
    const { doc, a, b, c } = doc3();
    const e1 = connect(doc, { node: a.id, pin: 'out' }, { node: b.id, pin: 'a' })!;
    connect(doc, { node: b.id, pin: 'out' }, { node: c.id, pin: 'in' });
    addReroute(doc, e1.id, [100, 20]);
    expect(Object.keys(doc.edges)).toHaveLength(2);
    expect(Object.keys(doc.reroutes)).toHaveLength(1);
    removeNode(doc, b.id);
    expect(doc.nodes[b.id]).toBeUndefined();
    expect(Object.keys(doc.edges)).toHaveLength(0); // both edges touched b
    expect(Object.keys(doc.reroutes)).toHaveLength(0); // reroute of e1 cascaded
    expect(incidentEdges(doc, a.id)).toHaveLength(0);
  });

  it('threads and removes reroute knots on an edge', () => {
    const { doc, a, b } = doc3();
    const e = connect(doc, { node: a.id, pin: 'out' }, { node: b.id, pin: 'a' })!;
    const r1 = addReroute(doc, e.id, [50, 10])!;
    const r2 = addReroute(doc, e.id, [150, 10], 0)!;
    expect(doc.edges[e.id]!.via).toEqual([r2.id, r1.id]);
    removeReroute(doc, r2.id);
    expect(doc.edges[e.id]!.via).toEqual([r1.id]);
    expect(doc.reroutes[r2.id]).toBeUndefined();
  });

  it('disconnect drops the edge and its reroutes', () => {
    const { doc, a, b } = doc3();
    const e = connect(doc, { node: a.id, pin: 'out' }, { node: b.id, pin: 'a' })!;
    addReroute(doc, e.id, [50, 10]);
    disconnect(doc, e.id);
    expect(doc.edges[e.id]).toBeUndefined();
    expect(Object.keys(doc.reroutes)).toHaveLength(0);
  });

  it('adds, moves, and removes groups', () => {
    const { doc } = doc3();
    const g = addGroup(doc, [10, 20, 300, 200], 'Cluster', 'subgraph');
    expect(doc.groups[g.id]).toBeDefined();
    expect(g.categoryId).toBe('subgraph');
    moveGroup(doc, g.id, 50, 60);
    expect(doc.groups[g.id]!.rect).toEqual([50, 60, 300, 200]);
    removeGroup(doc, g.id);
    expect(doc.groups[g.id]).toBeUndefined();
  });

  it('moves nodes and sets field values in place', () => {
    const { doc, a } = doc3();
    const pos = a.pos;
    moveNode(doc, a.id, [12, 34]);
    expect(a.pos).toBe(pos); // same array identity, mutated in place
    expect(a.pos).toEqual([12, 34]);
    setFieldValue(doc, a.id, 'mode', 'Add');
    expect(doc.nodes[a.id]!.fieldValues.mode).toBe('Add');
  });
});

describe('serialize', () => {
  it('round-trips a document losslessly', () => {
    const { doc, a, b, c } = doc3();
    const e = connect(doc, { node: a.id, pin: 'out' }, { node: b.id, pin: 'a' })!;
    connect(doc, { node: b.id, pin: 'out' }, { node: c.id, pin: 'in' });
    addReroute(doc, e.id, [100, 20]);
    setFieldValue(doc, b.id, 'mode', 'Multiply');

    const restored = deserializeGraph(serializeGraph(doc));
    expect(restored).toEqual(doc);
  });

  it('rejects an unknown format version', () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ version: 999, guid: 'g', kindId: 'k' }));
    expect(() => deserializeGraph(bytes)).toThrow(/unsupported format version/);
  });

  it('rebuilds counters and nodeOrder for a hand-authored file', () => {
    const file = {
      version: GRAPH_FORMAT_VERSION,
      guid: 'g',
      kindId: 'dataflow',
      nodes: { n5: { id: 'n5', typeId: 'X', pos: [0, 0], fieldValues: {} } },
      edges: {},
      reroutes: {},
      groups: {},
      // nodeOrder + counters omitted
    };
    const doc = deserializeGraph(new TextEncoder().encode(JSON.stringify(file)));
    expect(doc.nodeOrder).toEqual(['n5']);
    expect(doc.counters.node).toBe(5); // so the next minted id is n6, not a collision
  });
});
