// Device-verification harness for temporal anti-aliasing (Phase 12.6, ADR-0053).
// TAA is GPU-only: a green `bun test` proves the pipeline compiles and the
// resources cycle, not that jitter anti-aliases or that history reprojects
// without ghosting. Open ?mode=taa in a WebGPU browser (restart the dev server
// first — it does not hot-reload engine changes).
//
// What to look for:
//   - Edges of the thin posts and the diagonal rail are smooth, not stair-stepped.
//   - Press T to toggle TAA off/on: edges visibly crawl/alias with it off and
//     settle when it is back on — the A/B that proves jitter + resolve are live.
//   - The orbiting white sphere stays sharp with a clean trailing edge (no
//     smeared ghost), proving neighborhood clipping rejects stale history.
//
// The camera carries Depth + MotionVector prepass (TAA reprojects along the
// motion target) and is HDR (the resolve reads the sampleable HDR intermediate).

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
  PrepassPlugin,
  Query,
  ResMut,
  Sphere,
  StandardMaterial,
  StandardMaterialPlugin,
  Taa,
  Time,
  Transform,
} from '@retro-engine/engine';

type Vec4Lit = Float32Array & { readonly length: 4 };
const rgba = (r: number, g: number, b: number): Vec4Lit =>
  vec4.create(r, g, b, 1) as unknown as Vec4Lit;

/** Marker: a mesh orbiting in the X/Y plane, to test history reprojection. */
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
 * Playground harness that drives TAA on a high-contrast scene (thin posts + a
 * diagonal rail, where aliasing is obvious) plus one orbiting sphere (to test
 * that history does not ghost). Press T to toggle the camera's `Taa` component.
 */
export const taaShowcasePlugin: Plugin = (app) => {
  const log = app.logger.child('taa');
  const pbr = new MaterialPlugin(StandardMaterial);
  app.addPlugin(new StandardMaterialPlugin());
  app.addPlugin(pbr);
  app.insertResource(new AmbientLight({ color: vec3.create(0.6, 0.65, 0.8), brightness: 0.25 }));
  app.addPlugin(new Light3dPlugin());
  app.addPlugin(new PrepassPlugin());

  // Live A/B toggle: press T to add / remove the Taa component on the camera so
  // the same edges snap between aliased (crawling) and resolved (smooth).
  let taaOn = true;
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', (e) => {
      if (e.key === 't' || e.key === 'T') {
        taaOn = !taaOn;
        log.info(`TAA ${taaOn ? 'ON' : 'OFF'} (press T to toggle)`);
      }
    });
  }
  app.addSystem('update', [Query([Camera])], (cameras) => {
    const ids = [...cameras.entries()].map((row) => row[0]);
    for (const id of ids) {
      const has = app.world.has(id, Taa);
      if (taaOn && !has) app.world.insertBundle(id, [new Taa()]);
      else if (!taaOn && has) app.world.removeComponent(id, Taa);
    }
  });

  // Orbit the sphere each frame so its previous-frame model matrix differs —
  // the motion the resolve reprojects history along.
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
      // Thin tall posts: lots of near-vertical edges that alias hard untreated.
      const post = meshes.add(new Cuboid({ halfSize: [0.06, 1.4, 0.06] }).mesh().build());
      for (let i = 0; i < 9; i++) {
        const material = materials.add(
          new StandardMaterial({
            baseColor: rgba(0.9, 0.9, 0.92),
            metallic: 0.0,
            roughness: 0.5,
          }),
        );
        const transform = new Transform();
        transform.translation = vec3.create((i - 4) * 0.7, 1.4, 0);
        cmd.spawn(new Mesh3d(post), new pbr.MeshMaterial3d(material), transform);
      }

      // A thin diagonal rail — the canonical "jaggies" edge.
      const rail = meshes.add(new Cuboid({ halfSize: [4.0, 0.05, 0.05] }).mesh().build());
      const railMat = materials.add(
        new StandardMaterial({ baseColor: rgba(0.95, 0.5, 0.25), metallic: 0.1, roughness: 0.5 }),
      );
      const railT = new Transform();
      railT.translation = vec3.create(0, 1.4, 1.2);
      quat.fromAxisAngle(vec3.create(0, 0, 1), Math.PI / 7, railT.rotation);
      cmd.spawn(new Mesh3d(rail), new pbr.MeshMaterial3d(railMat), railT);

      // One orbiting sphere to confirm history does not ghost on motion.
      const sphere = meshes.add(new Sphere({ radius: 0.45 }).mesh().build());
      const sphereMat = materials.add(
        new StandardMaterial({ baseColor: rgba(1, 1, 1), metallic: 0, roughness: 0.4 }),
      );
      const sphereT = new Transform();
      sphereT.translation = vec3.create(0, 2.4, 0.5);
      cmd.spawn(
        new Mesh3d(sphere),
        new pbr.MeshMaterial3d(sphereMat),
        sphereT,
        new Orbit2d(0, 2.4, 1.6, 1.2, 0),
      );

      // Static ground.
      const ground = meshes.add(new Cuboid({ halfSize: [30, 0.1, 30] }).mesh().build());
      const groundMat = materials.add(
        new StandardMaterial({ baseColor: rgba(0.18, 0.18, 0.2), metallic: 0, roughness: 0.9 }),
      );
      const groundT = new Transform();
      groundT.translation = vec3.create(0, -0.1, 0);
      cmd.spawn(new Mesh3d(ground), new pbr.MeshMaterial3d(groundMat), groundT);

      const sunT = new Transform();
      quat.fromAxisAngle(vec3.create(1, 0, 0), -0.7, sunT.rotation);
      cmd.spawn(new DirectionalLight3d({ color: vec3.create(1, 0.97, 0.9), intensity: 3 }), sunT);

      // HDR camera (the resolve needs the sampleable HDR intermediate) carrying
      // Depth + MotionVector prepass. The toggle system owns the Taa component.
      const camT = new Transform();
      camT.translation = vec3.create(0, 2.4, 7);
      quat.fromAxisAngle(vec3.create(1, 0, 0), -Math.PI / 12, camT.rotation);
      cmd.spawn(
        ...Camera3d({ transform: camT, hdr: true }),
        new DepthPrepass(),
        new MotionVectorPrepass(),
      );

      log.info(
        'spawned a high-contrast TAA scene — if edges are smooth and the orbiting sphere does not ghost, jitter + resolve work on this device. Press T to toggle TAA.',
      );
    },
  );
};
