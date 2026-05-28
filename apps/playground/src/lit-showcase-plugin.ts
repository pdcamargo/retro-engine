// Visual verification harness for Phase 10's 3D analytic lighting + shadow maps
// (ADR-0044 / ADR-0045) and cascaded directional shadows (ADR-0046).
//
// This scene is tuned to make the SUN'S cascaded shadows the subject: a strong,
// low directional light rakes across a large ground plane, a field of boxes and
// PBR spheres recedes into the distance, and the camera dollies through that
// depth. Cascaded shadow maps fit the shadow to the camera frustum, so the sun's
// shadows stay crisp from the near boxes out to the far ones (the old fixed
// origin box could only shadow near the world centre) and stay stable — no
// shimmer/crawl — as the camera moves. Two dim point lights add fill + specular
// highlights so the metallic/roughness sweep on the spheres still reads.
//
// GPU shading is not headless-verifiable; open ?mode=lit in a WebGPU browser
// (restart the dev server first — it does not hot-reload engine changes).

import { quat, vec3, vec4 } from '@retro-engine/math';
import type { Plugin } from '@retro-engine/engine';
import {
  AmbientLight,
  Camera3d,
  CascadeShadowConfig,
  Commands,
  Cuboid,
  DirectionalLight3d,
  Light3dPlugin,
  MaterialPlugin,
  Mesh3d,
  Meshes,
  PointLight3d,
  Query,
  ResMut,
  Shadow3dSettings,
  ShadowFilteringMethod,
  Sphere,
  StandardMaterial,
  StandardMaterialPlugin,
  Time,
  Transform,
} from '@retro-engine/engine';

const GRID = 4;
const SPACING = 1.6;
// Ground top sits at y = 0 so everything rests on the floor and casts a grounded shadow.
const GROUND_TOP = 0;

/** Marker: a light that circles the grid each frame. */
class Orbit {
  constructor(
    public readonly radius: number,
    public readonly height: number,
    public readonly speed: number,
    public readonly phase: number,
  ) {}
}

/** Marker: the camera dollies back and forth along Z to sweep through cascades. */
class CameraDolly {
  constructor(
    public readonly baseZ: number,
    public readonly amplitude: number,
    public readonly speed: number,
  ) {}
}

const rgba = (r: number, g: number, b: number): Vec4Lit =>
  vec4.create(r, g, b, 1) as unknown as Vec4Lit;
type Vec4Lit = Float32Array & { readonly length: 4 };

/**
 * Playground showcase for 3D analytic lighting + cascaded shadows. A low "sun"
 * rakes long shadows across a large ground plane from a field of boxes and a
 * metallic/roughness sphere sweep that recede into the distance; the camera
 * dollies through that depth so the sun's cascaded shadows can be seen staying
 * crisp near-to-far and stable under motion. Requires `Light3dPlugin` alongside
 * the `StandardMaterial` plugins.
 */
export const litShowcasePlugin: Plugin = (app) => {
  const log = app.logger.child('lit-showcase');
  const pbr = new MaterialPlugin(StandardMaterial);
  app.addPlugin(new StandardMaterialPlugin());
  app.addPlugin(pbr);
  // Dim cool ambient so the sun's shadows keep contrast. Inserted before
  // Light3dPlugin so the plugin's default-insert guard leaves it alone.
  app.insertResource(new AmbientLight({ color: vec3.create(0.55, 0.6, 0.75), brightness: 0.06 }));
  // Cascaded directional shadows fit the camera frustum automatically now — no
  // fixed-box extent tuning needed (that was the ADR-0045 limitation cascades fix).
  app.addPlugin(new Light3dPlugin());

  // Optional ?pcf=castano13 / ?pcf=pcf5x5 URL switch for visually comparing the
  // shadow filtering kernels (ADR-0047). Default `Hardware2x2` is unchanged.
  const pcfParam =
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('pcf') : null;
  const pcfMethod =
    pcfParam === 'castano13'
      ? ShadowFilteringMethod.Castano13
      : pcfParam === 'pcf5x5'
        ? ShadowFilteringMethod.Pcf5x5
        : ShadowFilteringMethod.Hardware2x2;
  app.getResource(Shadow3dSettings)!.filteringMethod = pcfMethod;
  log.info(`shadow filtering = ${pcfMethod} (pcf URL param = ${pcfParam ?? 'unset'})`);

  // Orbit the point lights around the grid centre (fill + moving highlights).
  app.addSystem('update', [Query([Transform, Orbit]), ResMut(Time)], (lights, time) => {
    const t = time.virtual.elapsed;
    for (const [entity, transform, orbit] of lights.entries()) {
      const a = t * orbit.speed + orbit.phase;
      transform.translation = vec3.create(
        Math.cos(a) * orbit.radius,
        orbit.height,
        Math.sin(a) * orbit.radius,
      );
      app.world.markChanged(entity, Transform);
    }
  });

  // Dolly the camera through the scene depth so cascade transitions + stability show.
  app.addSystem('update', [Query([Transform, CameraDolly]), ResMut(Time)], (cams, time) => {
    const t = time.virtual.elapsed;
    for (const [entity, transform, dolly] of cams.entries()) {
      const pos = transform.translation;
      transform.translation = vec3.create(
        pos[0] as number,
        pos[1] as number,
        dolly.baseZ + Math.sin(t * dolly.speed) * dolly.amplitude,
      );
      app.world.markChanged(entity, Transform);
    }
  });

  app.addSystem(
    'startup',
    [Commands, ResMut(Meshes), ResMut(pbr.Materials)],
    (cmd, meshes, materials) => {
      const sphere = meshes.add(new Sphere({ radius: 0.6 }).mesh().build());

      // Metallic (X) × roughness (Z) sphere sweep, resting on the ground near the camera.
      for (let col = 0; col < GRID; col++) {
        for (let row = 0; row < GRID; row++) {
          const metallic = col / (GRID - 1);
          const roughness = Math.max(0.05, row / (GRID - 1));
          const material = materials.add(
            new StandardMaterial({ baseColor: rgba(0.9, 0.45, 0.35), metallic, roughness }),
          );
          const transform = new Transform();
          transform.translation = vec3.create(
            (col - (GRID - 1) / 2) * SPACING,
            GROUND_TOP + 0.6,
            (row - (GRID - 1) / 2) * SPACING + 6,
          );
          cmd.spawn(new Mesh3d(sphere), new pbr.MeshMaterial3d(material), transform);
        }
      }

      // Large matte ground plane so distant shadows have somewhere to land.
      const ground = meshes.add(new Cuboid({ halfSize: [60, 0.1, 60] }).mesh().build());
      const groundMat = materials.add(
        new StandardMaterial({ baseColor: rgba(0.22, 0.22, 0.24), metallic: 0, roughness: 0.9 }),
      );
      const groundT = new Transform();
      groundT.translation = vec3.create(0, GROUND_TOP - 0.1, 0);
      cmd.spawn(new Mesh3d(ground), new pbr.MeshMaterial3d(groundMat), groundT);

      // A field of boxes of varied height receding into the distance (−Z). Near
      // ones land in the first cascade, far ones in later cascades; the sun's
      // long shadows from them are the cascade demo.
      const boxMat = materials.add(
        new StandardMaterial({ baseColor: rgba(0.5, 0.55, 0.6), metallic: 0.1, roughness: 0.7 }),
      );
      const boxMeshes = new Map<number, ReturnType<typeof meshes.add>>();
      const boxOf = (h: number) => {
        const key = Math.round(h * 10);
        let m = boxMeshes.get(key);
        if (m === undefined) {
          m = meshes.add(new Cuboid({ halfSize: [0.7, h, 0.7] }).mesh().build());
          boxMeshes.set(key, m);
        }
        return m;
      };
      for (let i = 0; i < 9; i++) {
        const h = 1 + (i % 3); // 1, 2, 3 repeating
        const t = new Transform();
        // Two staggered rows so shadows from the back row reach between the front row.
        const x = i % 2 === 0 ? -4 : 4;
        t.translation = vec3.create(x + (i % 3) - 1, GROUND_TOP + h, -3 - i * 3.5);
        cmd.spawn(new Mesh3d(boxOf(h)), new pbr.MeshMaterial3d(boxMat), t);
      }

      // Strong, low "sun": pitched down moderately + yawed, so shadows rake long
      // and diagonally across the ground toward the camera (clearly visible).
      const sunT = new Transform();
      quat.fromAxisAngle(vec3.create(1, 0, 0), -0.5, sunT.rotation);
      quat.rotateY(sunT.rotation, 0.6, sunT.rotation);
      // Pack the cascades onto the actual content depth (the sphere sweep starts
      // ~2 units ahead and the box field ends ~45 units out) so the 1024² maps
      // are not wasted on empty near/far space — keeps near shadows as crisp as
      // hard cascaded shadows get (soft edges arrive with PCF, the next stage).
      cmd.spawn(
        new DirectionalLight3d({ color: vec3.create(1, 0.96, 0.88), intensity: 3.2 }),
        new CascadeShadowConfig({ minimumDistance: 2, maximumDistance: 50, lambda: 0.85 }),
        sunT,
      );

      // Two dim orbiting point lights — warm + cool fill so the PBR sweep reads.
      cmd.spawn(
        new PointLight3d({ color: vec3.create(1, 0.6, 0.3), intensity: 8, range: 10 }),
        new Transform(),
        new Orbit(4, 2.5, 0.8, 0),
      );
      cmd.spawn(
        new PointLight3d({ color: vec3.create(0.4, 0.6, 1), intensity: 8, range: 10 }),
        new Transform(),
        new Orbit(4, 2.5, 0.8, Math.PI),
      );

      // Camera close behind the sphere sweep, looking down the receding field;
      // dollies along Z so the near spheres stay in the tight first cascade.
      const camT = new Transform();
      camT.translation = vec3.create(0, 4, 13);
      quat.fromAxisAngle(vec3.create(1, 0, 0), -Math.PI / 11, camT.rotation);
      cmd.spawn(...Camera3d({ transform: camT }), new CameraDolly(13, 4, 0.22));

      log.info('spawned PBR sphere sweep + receding box field under a raking sun');
    },
  );
};
