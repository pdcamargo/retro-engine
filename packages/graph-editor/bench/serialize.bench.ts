// Serialize / deserialize a graph document. Off the frame loop, but its cost
// grows with document size (scene save/load, MCP get, hot-reload swap), so it is
// tracked. See docs/adr/ADR-0017 for methodology.

import { bench, summary } from 'mitata';

import { deserializeGraph, serializeGraph } from '../src/serialize';
import { makeGridGraph } from './helpers';

const g100 = makeGridGraph(100);
const g500 = makeGridGraph(500);
const g500Bytes = serializeGraph(g500);

summary(() => {
  bench('serializeGraph (100 nodes)', function* () {
    yield () => serializeGraph(g100);
  });
  bench('serializeGraph (500 nodes)', function* () {
    yield () => serializeGraph(g500);
  });
  bench('deserializeGraph (500 nodes)', function* () {
    yield () => deserializeGraph(g500Bytes);
  });
});
