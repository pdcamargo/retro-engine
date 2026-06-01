// Visual verification harness for StandardMaterial's `normalScale` (glTF
// normalTexture.scale) and `doubleSided` (per-material cull + back-face normal
// flip).
//
// Two demos under one camera:
//
//   1. normalScale row (top, facing the camera) — three identical planes share
//      one wavy ("egg-carton") normal map and differ only in `normalScale`
//      (0, 1, 2). Lit by a grazing directional light: the left plane shades
//      flat (scale 0 cancels the map), the middle shows the authored relief
//      (scale 1), the right exaggerates it (scale 2).
//
//   2. double-sided pair (bottom) — two vertical planes spin about the world Y
//      axis like revolving doors. The left is single-sided (default): it
//      vanishes for half of every turn, when its back faces the camera and the
//      back faces are culled. The right is `doubleSided: true`: it stays
//      visible through the whole turn AND stays correctly lit (the shader flips
//      the normal on back faces) instead of going black.
//
// GPU shading is not headless-verifiable; open ?mode=material in a WebGPU
// browser (restart the dev server first — it does not hot-reload engine
// changes).

import { quat, vec3, vec4 } from '@retro-engine/math';
import type { Plugin } from '@retro-engine/engine';
import {
  AmbientLight,
  Camera3d,
  Commands,
  DirectionalLight3d,
  Image,
  Images,
  Light3dPlugin,
  MaterialPlugin,
  Mesh3d,
  Meshes,
  Plane3d,
  PointLight3d,
  Query,
  ResMut,
  StandardMaterial,
  StandardMaterialPlugin,
  Time,
  Transform,
} from '@retro-engine/engine';

type Vec4Lit = Float32Array & { readonly length: 4 };
const rgba = (r: number, g: number, b: number): Vec4Lit =>
  vec4.create(r, g, b, 1) as unknown as Vec4Lit;

/**
 * Generate a `size × size` tangent-space normal map of a smooth "egg-carton"
 * height field `h = sin(k·u)·sin(k·v)`, encoded `n * 0.5 + 0.5`. Authored as
 * linear data (a normal map must not be sRGB-decoded). The amplitude is tuned
 * so the surface slope peaks near 45°, giving `normalScale` an obvious range.
 */
const wavyNormalMap = (size: number, cycles: number): Image => {
  const data = new Uint8Array(size * size * 4);
  const k = cycles * 2 * Math.PI;
  const amplitude = 1 / k; // peak slope ≈ 1 (≈45°) at scale 1
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;
      const dhdu = amplitude * k * Math.cos(k * u) * Math.sin(k * v);
      const dhdv = amplitude * k * Math.sin(k * u) * Math.cos(k * v);
      let nx = -dhdu;
      let ny = -dhdv;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;
      const i = (y * size + x) * 4;
      data[i] = Math.round((nx * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      data[i + 3] = 255;
    }
  }
  return Image.fromBytes({
    data,
    format: 'rgba8unorm',
    colorSpace: 'linear',
    width: size,
    height: size,
    label: 'material-showcase-wavy-normal',
  });
};

/** Marker: a vertical plane that revolves about the world Y axis each frame. */
class Spin {
  constructor(public readonly speed: number) {}
}

// Plane3d lies on XZ (normal +Y); standing it upright (90° about X) faces its
// front toward +Z so it addresses the camera before any spin is applied.
const UPRIGHT = Math.PI / 2;

/**
 * Playground showcase for `StandardMaterial.normalScale` and `doubleSided`.
 * Requires `Light3dPlugin` alongside the `StandardMaterial` plugins.
 */
export const materialShowcasePlugin: Plugin = (app) => {
  const log = app.logger.child('material-showcase');
  const pbr = new MaterialPlugin(StandardMaterial);
  app.addPlugin(new StandardMaterialPlugin());
  app.addPlugin(pbr);
  app.insertResource(new AmbientLight({ color: vec3.create(0.5, 0.55, 0.7), brightness: 0.08 }));
  app.addPlugin(new Light3dPlugin());

  // Revolve the double-sided pair about the world Y axis so each plane turns
  // its front, then its back, toward the camera once per revolution.
  app.addSystem('update', [Query([Transform, Spin]), ResMut(Time)], (planes, time) => {
    const t = time.virtual.elapsed;
    const tilt = quat.fromAxisAngle(vec3.create(1, 0, 0), UPRIGHT);
    for (const [entity, transform, spin] of planes.entries()) {
      const yaw = quat.fromAxisAngle(vec3.create(0, 1, 0), t * spin.speed);
      // World-yaw ∘ upright-tilt, written into the existing rotation.
      quat.multiply(yaw, tilt, transform.rotation);
      app.world.markChanged(entity, Transform);
    }
  });

  app.addSystem(
    'startup',
    [Commands, ResMut(Meshes), ResMut(pbr.Materials), ResMut(Images)],
    (cmd, meshes, materials, images) => {
      const quad = meshes.add(new Plane3d({ halfSize: [1, 1] }).mesh().build());
      const normalMap = images.add(wavyNormalMap(256, 4));

      // 1. normalScale row — same wavy normal map, scale 0 / 1 / 2, facing the
      //    camera so the grazing light reveals the relief difference.
      const scales = [0, 1, 2];
      for (let i = 0; i < scales.length; i++) {
        const material = materials.add(
          new StandardMaterial({
            baseColor: rgba(0.82, 0.82, 0.85),
            metallic: 0,
            roughness: 0.45,
            normalMapTexture: normalMap,
            normalScale: scales[i]!,
          }),
        );
        const transform = new Transform();
        // Top row, all at the same depth so none occludes another.
        transform.translation = vec3.create((i - 1) * 3, 2.7, 0);
        quat.fromAxisAngle(vec3.create(1, 0, 0), UPRIGHT, transform.rotation);
        cmd.spawn(new Mesh3d(quad), new pbr.MeshMaterial3d(material), transform);
      }

      // 2. double-sided pair — left single-sided (default), right double-sided,
      //    both revolving. Distinct base colours so it is clear which is which.
      const singleSided = materials.add(
        new StandardMaterial({ baseColor: rgba(0.9, 0.4, 0.35), metallic: 0, roughness: 0.5 }),
      );
      const doubleSided = materials.add(
        new StandardMaterial({
          baseColor: rgba(0.4, 0.8, 0.45),
          metallic: 0,
          roughness: 0.5,
          doubleSided: true,
        }),
      );
      // Lower row, same depth as the normalScale row — a distinct band beneath
      // it. Left single-sided, right double-sided, both revolving in sync so
      // the single-sided one visibly drops out while the double-sided stays.
      const tallQuad = meshes.add(new Plane3d({ halfSize: [0.85, 1.05] }).mesh().build());
      const leftT = new Transform();
      leftT.translation = vec3.create(-1.7, 0.2, 0);
      cmd.spawn(new Mesh3d(tallQuad), new pbr.MeshMaterial3d(singleSided), leftT, new Spin(1.2));
      const rightT = new Transform();
      rightT.translation = vec3.create(1.7, 0.2, 0);
      cmd.spawn(new Mesh3d(tallQuad), new pbr.MeshMaterial3d(doubleSided), rightT, new Spin(1.2));

      // Grazing key light so the normal-map relief casts visible shading; a
      // dim point light fills the spinning pair from the camera side.
      const sunT = new Transform();
      quat.fromAxisAngle(vec3.create(1, 0, 0), -0.35, sunT.rotation);
      quat.rotateY(sunT.rotation, 0.5, sunT.rotation);
      cmd.spawn(new DirectionalLight3d({ color: vec3.create(1, 0.97, 0.9), intensity: 3 }), sunT);

      const fillT = new Transform();
      fillT.translation = vec3.create(0, 1.5, 7);
      cmd.spawn(new PointLight3d({ color: vec3.create(0.7, 0.8, 1), intensity: 12, range: 20 }), fillT);

      // Pulled back + slightly down so the normalScale row (top) and the
      // double-sided pair (bottom) both frame without overlap.
      const camT = new Transform();
      camT.translation = vec3.create(0, 1.6, 11);
      quat.fromAxisAngle(vec3.create(1, 0, 0), -Math.PI / 22, camT.rotation);
      cmd.spawn(...Camera3d({ transform: camT }));

      log.info(
        'top row = normalScale 0 / 1 / 2 (flat → exaggerated). ' +
          'bottom pair = single-sided (left, drops out each turn) vs double-sided (right, stays).',
      );
    },
  );
};
