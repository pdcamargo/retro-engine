// Edge geometry is resolved for every edge every frame — once to draw, once to
// hit-test. Path construction + point-to-shape distance scale with edge/segment
// count, so they are tracked. See docs/adr/ADR-0017 for methodology and
// docs/adr/ADR-0143 for the pluggable edge-path layer these functions implement.

import { bench, summary } from 'mitata';

import { bezierPath, edgeShapeDistance, type EndpointGeom, orthogonalPath, straightPath } from '../src/edge-path';

const from: EndpointGeom = { pos: [100, 100], side: 'right' };
const to: EndpointGeom = { pos: [600, 340], side: 'left' };
const waypoints: [number, number][] = [
  [250, 120],
  [400, 300],
];
const input = { from, to, waypoints, zoom: 1 };

const bezierShape = bezierPath(input);
const straightShape = straightPath(input);

summary(() => {
  bench('bezierPath (2 waypoints)', function* () {
    yield () => bezierPath(input);
  });
  bench('straightPath (2 waypoints)', function* () {
    yield () => straightPath(input);
  });
  bench('orthogonalPath (2 waypoints)', function* () {
    yield () => orthogonalPath(input);
  });
  bench('edgeShapeDistance (bezier, miss)', function* () {
    yield () => edgeShapeDistance(bezierShape, -1000, -1000);
  });
  bench('edgeShapeDistance (straight, near)', function* () {
    yield () => edgeShapeDistance(straightShape, 350, 210);
  });
});
