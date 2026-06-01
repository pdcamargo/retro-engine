// Visual verification harness for the unified asset store (ADR-0055): proves
// the three runtime-mutation paths drive a visible GPU update, end to end.
//
//   1. materials.getMut(h) — pulse an UnlitMaterial's tint each frame. getMut
//      queues a `modified` event; the material-prepare system rebuilds the
//      bind group, so the left cube's colour animates.
//   2. meshes.getMut(h)    — breathe a sphere by rewriting its POSITION
//      attribute in place. The `modified` event makes the mesh-prepare system
//      free + re-allocate the vertex buffer through MeshAllocator and re-upload,
//      so the right sphere pulses in size.
//   3. meshes.add() / materials.add() at runtime — every ~0.8s, register a
//      fresh mesh + material and spawn a new cube, growing a row. Proves assets
//      added after startup render the same frame they finish preparing.
//
// GPU output is not headless-verifiable; open ?mode=assets in a WebGPU browser
// (restart the dev server first — it does not hot-reload engine changes).

import { quat, vec3, vec4 } from '@retro-engine/math';
import type { Handle, Plugin } from '@retro-engine/engine';
import {
  Camera3d,
  Commands,
  Cuboid,
  MaterialPlugin,
  Mesh,
  Mesh3d,
  MeshAttribute,
  Meshes,
  Res,
  ResMut,
  Sphere,
  Time,
  Transform,
  UnlitMaterial,
  UnlitMaterialPlugin,
} from '@retro-engine/engine';

type Vec4Color = Float32Array & { readonly length: 4 };
const rgb = (r: number, g: number, b: number): Vec4Color =>
  vec4.create(r, g, b, 1) as unknown as Vec4Color;

const MAX_RUNTIME_CUBES = 8;
const RUNTIME_SPAWN_INTERVAL = 0.8; // seconds

/**
 * Playground showcase for the unified `Assets<T>` store. Spawns two driven
 * objects — a cube whose material colour is hot-mutated via
 * `materials.getMut`, and a sphere whose geometry is hot-mutated via
 * `meshes.getMut` — then spawns a growing row of cubes from fresh
 * `meshes.add` / `materials.add` calls at runtime. Each path exercises a
 * different half of the extract → prepare pipeline (material bind-group
 * rebuild, mesh allocator re-upload, fresh-asset upload).
 */
export const assetShowcasePlugin: Plugin = (app) => {
  const log = app.logger.child('asset-showcase');
  const unlit = new MaterialPlugin(UnlitMaterial);
  app.addPlugin(new UnlitMaterialPlugin());
  app.addPlugin(unlit);

  // Closure state, assigned at startup and read each update.
  let pulseMaterial: Handle<UnlitMaterial>;
  let breatheMesh: Handle<Mesh>;
  let basePositions: Float32Array;
  let runtimeCubeCount = 0;
  let lastRuntimeSpawn = 0;

  app.addSystem(
    'startup',
    [Commands, ResMut(Meshes), ResMut(unlit.Materials)],
    (cmd, meshes, materials) => {
      // (1) Material hot-mutate target: a static cube on the left.
      const cubeMesh = meshes.add(new Cuboid({ halfSize: [0.6, 0.6, 0.6] }).mesh().build());
      pulseMaterial = materials.add(new UnlitMaterial({ color: rgb(0.9, 0.3, 0.3) }));
      const cubeT = new Transform();
      cubeT.translation = vec3.create(-2, 0.6, 0);
      cmd.spawn(new Mesh3d(cubeMesh), new unlit.MeshMaterial3d(pulseMaterial), cubeT);

      // (2) Mesh hot-mutate target: a sphere on the right. Capture its base
      // POSITION so each frame can scale from the pristine geometry. The
      // breathe stays in (0, 1] so it never exceeds the initial bounds the
      // frustum-cull AABB was computed from (bounds are gated on Mesh3d, not
      // on the asset, so they are not refreshed by an asset-only mutation).
      const sphere = new Sphere({ radius: 0.6 }).mesh().build();
      breatheMesh = meshes.add(sphere);
      basePositions = (sphere.getAttribute(MeshAttribute.POSITION)!.data as Float32Array).slice();
      const sphereMat = materials.add(new UnlitMaterial({ color: rgb(0.3, 0.7, 0.95) }));
      const sphereT = new Transform();
      sphereT.translation = vec3.create(2, 0.6, 0);
      cmd.spawn(new Mesh3d(breatheMesh), new unlit.MeshMaterial3d(sphereMat), sphereT);

      // Camera looking at both objects + the row that grows behind them.
      const camT = new Transform();
      camT.translation = vec3.create(0, 3.5, 8);
      quat.fromAxisAngle(vec3.create(1, 0, 0), -Math.PI / 8, camT.rotation);
      cmd.spawn(...Camera3d({ transform: camT }));

      log.info('spawned getMut targets (pulsing cube + breathing sphere); runtime add row grows behind them');
    },
  );

  app.addSystem(
    'update',
    [Commands, ResMut(Meshes), ResMut(unlit.Materials), Res(Time)],
    (cmd, meshes, materials, time) => {
      const t = time.virtual.elapsed;

      // (1) materials.getMut → mutate in place → `modified` → bind-group rebuild.
      const mat = materials.getMut(pulseMaterial);
      if (mat !== undefined) {
        mat.color = rgb(
          0.5 + 0.5 * Math.sin(t * 2),
          0.5 + 0.5 * Math.sin(t * 2 + 2.094),
          0.5 + 0.5 * Math.sin(t * 2 + 4.188),
        );
      }

      // (2) meshes.getMut → rewrite POSITION in place → `modified` → re-upload.
      const mesh = meshes.getMut(breatheMesh);
      if (mesh !== undefined) {
        const scale = 0.7 + 0.3 * Math.sin(t * 3);
        const scaled = new Float32Array(basePositions.length);
        for (let i = 0; i < basePositions.length; i++) scaled[i] = basePositions[i]! * scale;
        mesh.insertAttribute(MeshAttribute.POSITION, scaled);
      }

      // (3) Runtime add: register a brand-new mesh + material and spawn a cube.
      if (runtimeCubeCount < MAX_RUNTIME_CUBES && t - lastRuntimeSpawn >= RUNTIME_SPAWN_INTERVAL) {
        lastRuntimeSpawn = t;
        const i = runtimeCubeCount;
        const hue = i / MAX_RUNTIME_CUBES;
        const mesh = meshes.add(new Cuboid({ halfSize: [0.3, 0.3, 0.3] }).mesh().build());
        const material = materials.add(
          new UnlitMaterial({
            color: rgb(0.5 + 0.5 * Math.sin(hue * 6.283), 0.6, 0.5 + 0.5 * Math.cos(hue * 6.283)),
          }),
        );
        const cubeT = new Transform();
        cubeT.translation = vec3.create(-3.15 + i * 0.9, 0.3, -2.5);
        cmd.spawn(new Mesh3d(mesh), new unlit.MeshMaterial3d(material), cubeT);
        runtimeCubeCount += 1;
        log.info(`runtime add: spawned cube ${i + 1}/${MAX_RUNTIME_CUBES}`);
      }
    },
  );
};
