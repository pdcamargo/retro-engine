// Hit-testing runs every frame the cursor moves over the canvas. Its cost grows
// with node count, so it is tracked. See docs/adr/ADR-0017 for methodology.

import { bench, summary } from 'mitata';

import { createGraphEnvironment } from '../src/environment';
import { buildLayout, pick } from '../src/layout-cache';
import { DEFAULT_GEOMETRY } from '../src/theme';
import { makeGridGraph } from './helpers';

const env = createGraphEnvironment();
const kind = env.registerKind({ id: 'dataflow' });
kind.nodeTypes.register({
  type: 'Op',
  category: 'math',
  inputs: [
    { name: 'a', type: 'float' },
    { name: 'b', type: 'float' },
  ],
  outputs: [{ name: 'out', type: 'float' }],
});

const doc = makeGridGraph(500);
const layout = buildLayout(doc, env, DEFAULT_GEOMETRY);
const opts = { pinRadius: 7, rerouteRadius: 9, rowHalf: 11 };

summary(() => {
  bench('pick miss (empty space, 500 nodes)', function* () {
    yield () => pick(layout, doc, -10_000, -10_000, opts);
  });
  bench('pick hit (last node, 500 nodes)', function* () {
    yield () => pick(layout, doc, 60, 40, opts);
  });
});
