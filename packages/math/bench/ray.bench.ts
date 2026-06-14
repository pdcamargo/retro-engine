// Gizmo pick math — runs per frame, per handle, while a transform gizmo is
// hovered or dragged: unproject the cursor to a world ray, then intersect it
// against a constraint plane and project it onto a world axis. See docs/adr/ADR-0017.

import { mat4, vec3 } from 'wgpu-matrix';
import { bench, summary } from 'mitata';

import { Plane } from '../src/plane';
import { Ray, rayClosestPointToRay, rayPlaneIntersect } from '../src/ray';

const proj = mat4.perspective(Math.PI / 4, 16 / 9, 0.1, 100);
const view = mat4.lookAt(vec3.create(5, 4, 7), vec3.create(0, 0, 0), vec3.create(0, 1, 0));
const invViewProj = mat4.inverse(mat4.multiply(proj, view));

const plane = new Plane(vec3.create(0, 1, 0), 0);
const axis = new Ray(vec3.create(0, 0, 0), vec3.create(1, 0, 0));
const scratchRay = new Ray();
const scratchPoint = vec3.create(0, 0, 0);

summary(() => {
  bench('Ray.fromScreen (unproject cursor)', function* () {
    yield () => Ray.fromScreen(640, 360, 0, 0, 1280, 720, invViewProj, scratchRay);
  });
  bench('rayPlaneIntersect', function* () {
    const ray = Ray.fromScreen(640, 360, 0, 0, 1280, 720, invViewProj, scratchRay);
    yield () => rayPlaneIntersect(ray, plane);
  });
  bench('rayClosestPointToRay (axis drag)', function* () {
    const ray = Ray.fromScreen(640, 360, 0, 0, 1280, 720, invViewProj, scratchRay);
    yield () => rayClosestPointToRay(axis, ray, scratchPoint);
  });
});
