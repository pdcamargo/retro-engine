import { describe, expect, it } from 'bun:test';

import { createGraphDocument } from './document';
import { createGraphEnvironment } from './environment';
import { buildLayout, pick } from './layout-cache';
import { addNode } from './ops';
import { DEFAULT_GEOMETRY } from './theme';

const setup = () => {
  const env = createGraphEnvironment();
  const kind = env.registerKind({ id: 'dataflow' });
  kind.nodeTypes.register({
    type: 'Op',
    category: 'math',
    inputs: [{ name: 'a', type: 'float' }],
    outputs: [{ name: 'out', type: 'float' }],
  });
  const doc = createGraphDocument({ kindId: 'dataflow' });
  const n = addNode(doc, { typeId: 'Op', pos: [100, 100] });
  const layout = buildLayout(doc, env, DEFAULT_GEOMETRY);
  return { env, doc, n, layout, nl: layout.nodes.get(n.id)! };
};

const OPTS = { pinRadius: 7, rerouteRadius: 9 };

describe('pick', () => {
  it('returns null over empty space', () => {
    const { layout, doc } = setup();
    expect(pick(layout, doc, -500, -500, OPTS)).toBeNull();
  });

  it('hits a node body', () => {
    const { layout, doc, n, nl } = setup();
    const hit = pick(layout, doc, nl.x + nl.w / 2, nl.y + 4, OPTS);
    expect(hit).toEqual({ k: 'node', id: n.id });
  });

  it('hits an input pin on the left edge (pin beats body)', () => {
    const { layout, doc, n, nl } = setup();
    const a = nl.inputs[0]!.anchor;
    const hit = pick(layout, doc, a[0], a[1], OPTS);
    expect(hit).toEqual({ k: 'pin', node: n.id, pin: 'a', dir: 'in' });
  });

  it('hits an output pin on the right edge', () => {
    const { layout, doc, n, nl } = setup();
    const o = nl.outputs[0]!.anchor;
    const hit = pick(layout, doc, o[0], o[1], OPTS);
    expect(hit).toEqual({ k: 'pin', node: n.id, pin: 'out', dir: 'out' });
  });

  it('picks the top-most node when two overlap', () => {
    const { env, doc, layout: _l } = setup();
    const top = addNode(doc, { typeId: 'Op', pos: [110, 110] }); // overlaps the first
    const layout = buildLayout(doc, env, DEFAULT_GEOMETRY);
    const hit = pick(layout, doc, 140, 120, OPTS);
    expect(hit).toEqual({ k: 'node', id: top.id }); // last in nodeOrder = topmost
  });
});
