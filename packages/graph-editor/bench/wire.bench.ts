// Wire hit-testing samples each edge's bezier into a polyline; it runs while the
// cursor hovers empty canvas over a wire. Cost grows with edge count. See
// docs/adr/ADR-0017 for methodology.

import { bench, summary } from 'mitata';

import type { Point } from '../src/document';
import { wireDistance } from '../src/wire';

const straight: Point[] = [
  [0, 0],
  [400, 120],
];
const rerouted: Point[] = [
  [0, 0],
  [180, -60],
  [260, 90],
  [400, 120],
];

summary(() => {
  bench('wireDistance (straight, miss)', function* () {
    yield () => wireDistance(straight, 200, 400, 1);
  });
  bench('wireDistance (straight, near)', function* () {
    yield () => wireDistance(straight, 200, 60, 1);
  });
  bench('wireDistance (3 reroutes)', function* () {
    yield () => wireDistance(rerouted, 220, 40, 1);
  });
});
