// Visual verification harness for Phase 10's 3D analytic lighting + shadow maps
// (ADR-0044 / ADR-0045).
//
// Spawns a grid of `StandardMaterial` spheres with metallic increasing along
// X and roughness increasing along Z — the canonical PBR test layout — raised
// above a matte ground plane, lit by one directional "sun", two orbiting point
// lights (warm + cool), a downward spot light, and a dim ambient floor. The
// raised spheres cast shadows onto the ground from the sun + spot: watching the
// shadows track the lit grid (and the highlights track the orbiting lights)
// confirms the GpuLights uniform, the per-light loop in pbr.wgsl, the @group(2)
// binding, AND the shadow atlas / depth pass / shadow_factor all work end-to-end.
//
// GPU shading is not headless-verifiable; open ?mode=lit in a WebGPU browser
// (restart the dev server first — it does not hot-reload engine changes).

import { quat, vec3, vec4 } from '@retro-engine/math';
import type { Plugin } from '@retro-engine/engine';
import {
  AmbientLight,
  Camera3d,
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
  Sphere,
  SpotLight3d,
  StandardMaterial,
  StandardMaterialPlugin,
  Time,
  Transform,
} from '@retro-engine/engine';

const GRID = 4;
const SPACING = 1.6;

/** Marker: a light that circles the grid each frame. */
class Orbit {
  constructor(
    public readonly radius: number,
    public readonly height: number,
    public readonly speed: number,
    public readonly phase: number,
  ) {}
}

const rgba = (r: number, g: number, b: number): Vec4Lit =>
  vec4.create(r, g, b, 1) as unknown as Vec4Lit;
type Vec4Lit = Float32Array & { readonly length: 4 };

/**
 * Playground showcase for 3D analytic lighting. A 4×4 grid of `StandardMaterial`
 * spheres sweeps metallic (X) against roughness (Z) so the highlight shape and
 * specular response read clearly under the moving lights. Requires
 * `Light3dPlugin` alongside the `StandardMaterial` plugins.
 */
export const litShowcasePlugin: Plugin = (app) => {
  const log = app.logger.child('lit-showcase');
  const pbr = new MaterialPlugin(StandardMaterial);
  app.addPlugin(new StandardMaterialPlugin());
  app.addPlugin(pbr);
  // A dim, slightly-cool ambient floor. Inserted before Light3dPlugin so the
  // plugin's default-insert guard leaves it alone.
  app.insertResource(new AmbientLight({ color: vec3.create(0.6, 0.7, 0.9), brightness: 0.04 }));
  // Tighten the directional shadow frustum to the scene (ground is ±6). The
  // default extent (20) spreads the 1024² shadow map over a 40-unit box, which
  // reads as blocky directional shadows; ±8 is ~2.5× the texel density here.
  app.insertResource(new Shadow3dSettings({ directionalExtent: 8 }));
  app.addPlugin(new Light3dPlugin());

  // Orbit the point lights around the grid centre.
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

  app.addSystem(
    'startup',
    [Commands, ResMut(Meshes), ResMut(pbr.Materials)],
    (cmd, meshes, materials) => {
      const sphere = meshes.add(new Sphere({ radius: 0.6 }).mesh().build());

      for (let col = 0; col < GRID; col++) {
        for (let row = 0; row < GRID; row++) {
          const metallic = col / (GRID - 1);
          const roughness = Math.max(0.05, row / (GRID - 1));
          const material = materials.add(
            new StandardMaterial({ baseColor: rgba(0.9, 0.45, 0.35), metallic, roughness }),
          );
          const transform = new Transform();
          // Raised above the ground so the sun + spot cast visible shadows onto it.
          transform.translation = vec3.create(
            (col - (GRID - 1) / 2) * SPACING,
            1.5,
            (row - (GRID - 1) / 2) * SPACING,
          );
          cmd.spawn(new Mesh3d(sphere), new pbr.MeshMaterial3d(material), transform);
        }
      }

      // Matte ground plane beneath the grid.
      const ground = meshes.add(new Cuboid({ halfSize: [6, 0.1, 6] }).mesh().build());
      const groundMat = materials.add(
        new StandardMaterial({ baseColor: rgba(0.18, 0.18, 0.2), metallic: 0, roughness: 0.9 }),
      );
      const groundT = new Transform();
      groundT.translation = vec3.create(0, -0.8, 0);
      cmd.spawn(new Mesh3d(ground), new pbr.MeshMaterial3d(groundMat), groundT);

      // Directional "sun" tilted down and to the side.
      const sunT = new Transform();
      quat.fromAxisAngle(vec3.create(1, 0, 0), -Math.PI / 3, sunT.rotation);
      cmd.spawn(new DirectionalLight3d({ color: vec3.create(1, 0.97, 0.9), intensity: 2.5 }), sunT);

      // Two orbiting point lights — warm and cool.
      cmd.spawn(
        new PointLight3d({ color: vec3.create(1, 0.6, 0.3), intensity: 30, range: 12 }),
        new Transform(),
        new Orbit(4, 2.5, 0.8, 0),
      );
      cmd.spawn(
        new PointLight3d({ color: vec3.create(0.4, 0.6, 1), intensity: 30, range: 12 }),
        new Transform(),
        new Orbit(4, 2.5, 0.8, Math.PI),
      );

      // Spot light aimed straight down at the grid centre.
      const spotT = new Transform();
      spotT.translation = vec3.create(0, 6, 0);
      quat.fromAxisAngle(vec3.create(1, 0, 0), -Math.PI / 2, spotT.rotation);
      cmd.spawn(
        new SpotLight3d({
          color: vec3.create(0.9, 1, 0.95),
          intensity: 40,
          range: 14,
          innerAngle: Math.PI / 10,
          outerAngle: Math.PI / 6,
        }),
        spotT,
      );

      // Camera looking down at the grid.
      const camT = new Transform();
      camT.translation = vec3.create(0, 5, 9);
      quat.fromAxisAngle(vec3.create(1, 0, 0), -Math.PI / 7, camT.rotation);
      cmd.spawn(...Camera3d({ transform: camT }));

      log.info('spawned 16 PBR spheres (metallic × roughness) + sun/point/spot/ambient lights');
    },
  );
};
