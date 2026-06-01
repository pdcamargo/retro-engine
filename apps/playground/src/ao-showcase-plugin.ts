// Device-verification harness for screen-space ambient occlusion (GTAO),
// ADR-0054. AO is GPU-only: a green `bun test` proves the pipeline compiles and
// the resources cycle, not that occlusion actually darkens creases or that the
// depth reconstruction lines up under jitter. Open ?mode=ao in a WebGPU browser
// (restart the dev server first — it does not hot-reload engine changes).
//
// What to look for:
//   - Contact shadows where boxes meet the ground and each other, and darkening
//     in the inside corner where the two walls meet — soft, geometry-following.
//   - Press O to toggle AO off/on: those creases flatten with it off and return
//     with it on — the A/B that proves the pass feeds the forward ambient term.
//   - Add &taa=1 to also enable temporal AA: the AO must not swim or shimmer
//     under the sub-pixel jitter (validates the jittered-inverse reconstruction).
//
// AO modulates only the ambient/indirect term, so this scene is deliberately
// ambient-dominant (strong ambient, soft sun) — that is where AO is visible.

import { quat, vec3, vec4 } from '@retro-engine/math';
import type { Plugin } from '@retro-engine/engine';
import {
  AmbientLight,
  Camera,
  Camera3d,
  Commands,
  Cuboid,
  DepthPrepass,
  DirectionalLight3d,
  Light3dPlugin,
  MaterialPlugin,
  Mesh3d,
  Meshes,
  MotionVectorPrepass,
  NormalPrepass,
  PrepassPlugin,
  Query,
  ResMut,
  ScreenSpaceAo,
  Sphere,
  StandardMaterial,
  StandardMaterialPlugin,
  Taa,
  Transform,
} from '@retro-engine/engine';

type Vec4Lit = Float32Array & { readonly length: 4 };
const rgba = (r: number, g: number, b: number): Vec4Lit =>
  vec4.create(r, g, b, 1) as unknown as Vec4Lit;

/**
 * Playground harness driving GTAO on a scene full of contact points and a
 * concave corner, where ambient occlusion is obvious. Press O to toggle the
 * camera's `ScreenSpaceAo` component for an A/B. Append `&taa=1` to also run TAA
 * (checks the AO stays stable under camera jitter).
 */
export const aoShowcasePlugin: Plugin = (app) => {
  const log = app.logger.child('ao');
  const withTaa =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('taa') === '1';

  const pbr = new MaterialPlugin(StandardMaterial);
  app.addPlugin(new StandardMaterialPlugin());
  app.addPlugin(pbr);
  // Ambient-dominant lighting: AO modulates the ambient term, so a strong
  // ambient + soft sun makes the occlusion legible rather than washed out.
  app.insertResource(new AmbientLight({ color: vec3.create(0.85, 0.87, 0.95), brightness: 0.85 }));
  app.addPlugin(new Light3dPlugin());
  app.addPlugin(new PrepassPlugin());

  // Live A/B toggle: press O to add / remove the ScreenSpaceAo component.
  let aoOn = true;
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', (e) => {
      if (e.key === 'o' || e.key === 'O') {
        aoOn = !aoOn;
        log.info(`AO ${aoOn ? 'ON' : 'OFF'} (press O to toggle)`);
      }
    });
  }
  app.addSystem('update', [Query([Camera])], (cameras) => {
    const ids = [...cameras.entries()].map((row) => row[0]);
    for (const id of ids) {
      const has = app.world.has(id, ScreenSpaceAo);
      if (aoOn && !has) app.world.insertBundle(id, [new ScreenSpaceAo()]);
      else if (!aoOn && has) app.world.removeComponent(id, ScreenSpaceAo);
    }
  });

  app.addSystem(
    'startup',
    [Commands, ResMut(Meshes), ResMut(pbr.Materials)],
    (cmd, meshes, materials) => {
      const matte = (r: number, g: number, b: number) =>
        materials.add(new StandardMaterial({ baseColor: rgba(r, g, b), metallic: 0, roughness: 0.9 }));

      // Ground.
      const ground = meshes.add(new Cuboid({ halfSize: [12, 0.1, 12] }).mesh().build());
      const groundT = new Transform();
      groundT.translation = vec3.create(0, -0.1, 0);
      cmd.spawn(new Mesh3d(ground), new pbr.MeshMaterial3d(matte(0.55, 0.55, 0.58)), groundT);

      // A concave corner: two walls meeting — the inside edge should darken.
      const wall = meshes.add(new Cuboid({ halfSize: [3, 1.5, 0.15] }).mesh().build());
      const wallA = new Transform();
      wallA.translation = vec3.create(0, 1.5, -3);
      cmd.spawn(new Mesh3d(wall), new pbr.MeshMaterial3d(matte(0.7, 0.7, 0.72)), wallA);
      const wallB = new Transform();
      wallB.translation = vec3.create(-3, 1.5, 0);
      quat.fromAxisAngle(vec3.create(0, 1, 0), Math.PI / 2, wallB.rotation);
      cmd.spawn(new Mesh3d(wall), new pbr.MeshMaterial3d(matte(0.7, 0.7, 0.72)), wallB);

      // Boxes touching the ground and each other (contact AO).
      const box = meshes.add(new Cuboid({ halfSize: [0.6, 0.6, 0.6] }).mesh().build());
      const positions: ReadonlyArray<[number, number]> = [
        [1.0, 0.0],
        [2.2, 0.0],
        [1.6, 1.1],
        [-1.2, 1.5],
      ];
      for (const [x, z] of positions) {
        const t = new Transform();
        t.translation = vec3.create(x, 0.6, z);
        cmd.spawn(new Mesh3d(box), new pbr.MeshMaterial3d(matte(0.8, 0.78, 0.74)), t);
      }

      // A couple of spheres resting on the ground.
      const sphere = meshes.add(new Sphere({ radius: 0.7 }).mesh().build());
      for (const [x, z] of [[-1.5, -1.0], [0.4, -1.6]] as ReadonlyArray<[number, number]>) {
        const t = new Transform();
        t.translation = vec3.create(x, 0.7, z);
        cmd.spawn(new Mesh3d(sphere), new pbr.MeshMaterial3d(matte(0.85, 0.85, 0.88)), t);
      }

      // Soft sun for shape; the ambient term carries the AO contrast.
      const sunT = new Transform();
      quat.fromAxisAngle(vec3.create(1, 0, 0), -0.6, sunT.rotation);
      cmd.spawn(new DirectionalLight3d({ color: vec3.create(1, 0.97, 0.9), intensity: 0.8 }), sunT);

      const camT = new Transform();
      camT.translation = vec3.create(4.5, 4.0, 6.5);
      quat.fromEuler(-0.5, 0.6, 0, 'xyz', camT.rotation);
      // MotionVectorPrepass is always present so the AO temporal accumulation
      // pass is active (it reprojects history along the motion target); &taa=1
      // additionally jitters the camera to check AO stays stable under jitter.
      cmd.spawn(
        ...Camera3d({ transform: camT, hdr: true }),
        new DepthPrepass(),
        new NormalPrepass(),
        new MotionVectorPrepass(),
        ...(withTaa ? [new Taa()] : []),
      );

      log.info(
        `spawned an AO scene — if box/ground contacts and the wall corner darken (and flatten when you press O), GTAO works on this device${withTaa ? ' (TAA on: AO should stay stable, no swimming under jitter)' : ''}.`,
      );
    },
  );
};
