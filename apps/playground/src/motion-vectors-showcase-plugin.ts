// Device-verification harness for the screen-space motion-vector prepass
// (ADR-0050 / ADR-0051). The prepass had two device-fatal bugs that the test
// stub could not catch (vertex attribute locations above the WebGPU limit; a
// minification-fragile fragment-target gate), so a green `bun test` did not
// prove it ran on a real device. This scene exercises the most attribute-hungry
// prepass variant — Depth + Normal + MotionVector together, which builds the
// combined `fs_prepass_normal_motion` pipeline — against moving StandardMaterial
// meshes so motion is non-zero.
//
// Tier 1 (always): the app boots and renders without a pipeline-creation throw.
// Tier 2 (`?debug=motion`): a debug pass blits |velocity| to the screen — a
// static ground reads black, moving meshes glow red/green, proving the motion
// target carries correct data, not just that the pipeline compiled.
//
// GPU work is not headless-verifiable; open ?mode=motion-vectors (optionally
// &debug=motion) in a WebGPU browser (restart the dev server first — it does
// not hot-reload engine changes).

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
  MotionBlur,
  MotionVectorPrepass,
  NormalPrepass,
  PrepassPlugin,
  Query,
  ResMut,
  Sphere,
  StandardMaterial,
  StandardMaterialPlugin,
  Time,
  Transform,
} from '@retro-engine/engine';

import { installMotionVectorDebug } from './motion-vector-debug-node';

type Vec4Lit = Float32Array & { readonly length: 4 };
const rgba = (r: number, g: number, b: number): Vec4Lit =>
  vec4.create(r, g, b, 1) as unknown as Vec4Lit;

/**
 * Marker: a mesh that moves on a circle in the X/Y plane so its screen motion
 * has both a horizontal (→ red) and a vertical (→ green) component, exercising
 * both channels of the rg16float motion target.
 */
class Orbit2d {
  constructor(
    public readonly baseX: number,
    public readonly baseY: number,
    public readonly radius: number,
    public readonly speed: number,
    public readonly phase: number,
  ) {}
}

/**
 * Playground harness that drives Depth + Normal + MotionVector prepass on a
 * field of moving PBR meshes, to confirm the motion-vector prepass creates
 * pipelines and produces motion data on a real WebGPU device.
 */
export const motionVectorsShowcasePlugin: Plugin = (app) => {
  const log = app.logger.child('motion-vectors');
  const pbr = new MaterialPlugin(StandardMaterial);
  app.addPlugin(new StandardMaterialPlugin());
  app.addPlugin(pbr);
  app.insertResource(new AmbientLight({ color: vec3.create(0.6, 0.65, 0.8), brightness: 0.2 }));
  app.addPlugin(new Light3dPlugin());
  // The prepass markers are inert without this plugin — it owns the flag
  // extraction, per-camera target allocation, and the prepass graph node.
  app.addPlugin(new PrepassPlugin());

  const search =
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  // `?blur=1` exercises Phase 12.10 MotionBlur (HDR camera + MotionBlur
  // component) so the moving meshes streak. `?debug=motion` instead blits the
  // raw motion target. They are mutually exclusive — blur needs HDR + tonemap
  // on the swapchain, the debug blit overwrites it.
  const blur = search?.get('blur') === '1';
  const debugMotion = !blur && search?.get('debug') === 'motion';
  if (debugMotion) {
    installMotionVectorDebug(app);
    log.info('?debug=motion active — blitting the motion target (|velocity|) to screen');
  }

  if (blur) {
    // Strong, obvious blur for the demo, and a live toggle: press B to add /
    // remove the MotionBlur component on the camera so the same moving meshes
    // snap between sharp and streaked in place — the unmistakable A/B.
    // Exaggerated `intensity` for the demo: real per-frame screen motion here
    // is only a couple percent of the screen (the debug view multiplies it ×25
    // just to be visible), so intensity 1 produces an imperceptible smear.
    // Cranking it makes the streak an obvious comet — and doubles as a
    // diagnostic: if it stays sharp at this intensity, the blur is not reaching
    // the swapchain.
    const makeBlur = () =>
      new MotionBlur({ samples: 32, shutterAngle: 1.0, intensity: 5.0, maxVelocity: 0.4 });
    let blurOn = true;
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', (e) => {
        if (e.key === 'b' || e.key === 'B') {
          blurOn = !blurOn;
          log.info(`motion blur ${blurOn ? 'ON' : 'OFF'} (press B to toggle)`);
        }
      });
    }
    // Reconcile the camera's MotionBlur component to the toggle state each frame.
    app.addSystem('update', [Query([Camera])], (cameras) => {
      const ids = [...cameras.entries()].map((row) => row[0]);
      for (const id of ids) {
        const has = app.world.has(id, MotionBlur);
        if (blurOn && !has) app.world.insertBundle(id, [makeBlur()]);
        else if (!blurOn && has) app.world.removeComponent(id, MotionBlur);
      }
    });
    log.info('?blur=1 active — HDR camera + MotionBlur. Press B to toggle blur on/off.');
  }

  // Move the meshes on a circle in the X/Y plane each frame so their
  // previous-frame model matrix differs from the current one — the source of a
  // non-zero motion vector, with both a horizontal and a vertical component.
  app.addSystem('update', [Query([Transform, Orbit2d]), ResMut(Time)], (movers, time) => {
    const t = time.virtual.elapsed;
    for (const [entity, transform, orbit] of movers.entries()) {
      const a = t * orbit.speed + orbit.phase;
      transform.translation = vec3.create(
        orbit.baseX + Math.cos(a) * orbit.radius,
        orbit.baseY + Math.sin(a) * orbit.radius,
        transform.translation[2] as number,
      );
      app.world.markChanged(entity, Transform);
    }
  });

  app.addSystem(
    'startup',
    [Commands, ResMut(Meshes), ResMut(pbr.Materials)],
    (cmd, meshes, materials) => {
      const sphere = meshes.add(new Sphere({ radius: 0.6 }).mesh().build());
      const box = meshes.add(new Cuboid({ halfSize: [0.6, 0.6, 0.6] }).mesh().build());

      // A row of moving meshes (alternating sphere/box) with staggered phase so
      // the screen shows a spread of motion magnitudes/directions at any instant.
      for (let i = 0; i < 6; i++) {
        const material = materials.add(
          new StandardMaterial({
            baseColor: rgba(0.85, 0.4 + i * 0.08, 0.3),
            metallic: 0.1,
            roughness: 0.6,
          }),
        );
        const transform = new Transform();
        const baseX = (i - 2.5) * 1.8;
        const baseY = 1.2;
        transform.translation = vec3.create(baseX, baseY, 0);
        cmd.spawn(
          new Mesh3d(i % 2 === 0 ? sphere : box),
          new pbr.MeshMaterial3d(material),
          transform,
          new Orbit2d(baseX, baseY, 0.9, 1.0 + i * 0.2, i * 0.7),
        );
      }

      // One fast, bright-white orbiter on a big circle: its high tangential
      // speed produces a long, obvious streak under motion blur (a sharp white
      // ball with blur off, a white comet with blur on) — the clearest tell.
      const fastMat = materials.add(
        new StandardMaterial({ baseColor: rgba(1, 1, 1), metallic: 0, roughness: 0.4 }),
      );
      const fastT = new Transform();
      fastT.translation = vec3.create(0, 2.2, 0);
      cmd.spawn(
        new Mesh3d(sphere),
        new pbr.MeshMaterial3d(fastMat),
        fastT,
        new Orbit2d(0, 2.2, 2.4, 3.0, 0),
      );

      // Static ground plane — reads black in the motion debug view (zero motion).
      const ground = meshes.add(new Cuboid({ halfSize: [30, 0.1, 30] }).mesh().build());
      const groundMat = materials.add(
        new StandardMaterial({ baseColor: rgba(0.2, 0.2, 0.22), metallic: 0, roughness: 0.9 }),
      );
      const groundT = new Transform();
      groundT.translation = vec3.create(0, -0.1, 0);
      cmd.spawn(new Mesh3d(ground), new pbr.MeshMaterial3d(groundMat), groundT);

      // A plain directional light so the (non-debug) scene shades normally.
      const sunT = new Transform();
      quat.fromAxisAngle(vec3.create(1, 0, 0), -0.7, sunT.rotation);
      cmd.spawn(new DirectionalLight3d({ color: vec3.create(1, 0.97, 0.9), intensity: 3 }), sunT);

      // Camera carrying the full prepass marker set. The combined Depth +
      // Normal + MotionVector flags force the `fs_prepass_normal_motion`
      // pipeline — the variant the location bug rejected on a real device.
      // Default is non-HDR so the debug blit (when active) is the last write to
      // the swapchain; `?blur=1` flips it to HDR and attaches MotionBlur.
      const camT = new Transform();
      camT.translation = vec3.create(0, 3, 9);
      quat.fromAxisAngle(vec3.create(1, 0, 0), -Math.PI / 9, camT.rotation);
      // In blur mode the camera is HDR; the toggle system owns the MotionBlur
      // component (press B). Otherwise it is a plain non-HDR prepass camera.
      cmd.spawn(
        ...Camera3d({ transform: camT, ...(blur ? { hdr: true } : {}) }),
        new DepthPrepass(),
        new NormalPrepass(),
        new MotionVectorPrepass(),
      );

      log.info(
        'spawned moving PBR meshes under Depth + Normal + MotionVector prepass — if no pipeline-creation error appears, the prepass builds on this device',
      );
    },
  );
};
