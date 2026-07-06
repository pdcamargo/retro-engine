// Per-fixed-step cost of the physics bridge's Sync snapshot assembly
// (ADR-0148). buildBodySnapshot runs per body every fixed step, so it must stay
// cheap as body count grows. See ADR-0017.

import { bench, summary } from 'mitata';

import { quat, vec2, vec3 } from '@retro-engine/math';

import { snapshot2d, snapshot3d } from '../src/bridge';
import { Collider2d, LinearVelocity2d, RigidBody2d } from '../src/components-2d';
import { AngularVelocity3d, Collider3d, LinearVelocity3d, RigidBody3d } from '../src/components-3d';

const transform2d = { translation: vec3.create(1, 2, 0), rotation: quat.identity() };
const rb2 = RigidBody2d.dynamic();
const col2 = Collider2d.rectangle(0.5, 0.5);
const lin2 = new LinearVelocity2d(vec2.create(1, -3));

const transform3d = { translation: vec3.create(1, 2, 3), rotation: quat.identity() };
const rb3 = RigidBody3d.dynamic();
const col3 = Collider3d.cuboid(0.5, 0.5, 0.5);
const lin3 = new LinearVelocity3d(vec3.create(1, -3, 2));
const ang3 = new AngularVelocity3d(vec3.create(0, 1, 0));

for (const count of [64, 256, 1024]) {
  summary(() => {
    bench(`snapshot2d @ ${count} bodies`, function* () {
      yield () => {
        for (let i = 0; i < count; i += 1) {
          snapshot2d(rb2, col2, transform2d, false, lin2, 0.5, undefined, {});
        }
      };
    });
    bench(`snapshot3d @ ${count} bodies`, function* () {
      yield () => {
        for (let i = 0; i < count; i += 1) {
          snapshot3d(rb3, col3, transform3d, false, lin3, ang3, undefined, {});
        }
      };
    });
  });
}
