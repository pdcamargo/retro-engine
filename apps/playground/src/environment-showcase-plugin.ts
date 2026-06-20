// Visual verification harness for image-based lighting (increment 2). The same
// colored cube is the skybox AND the light source: a row of metallic spheres
// sweeps roughness 0→1 (sharp → blurry reflections of the cube), and a matte
// sphere on the end shows the diffuse irradiance tint. Analytic light is dim so
// the environment dominates and the IBL is unmistakable.
//
// Cube faces: +X red, -X cyan, +Y green (up), -Y magenta (down), +Z blue,
// -Z yellow.
//
// GPU shading is not headless-verifiable; open ?mode=ibl in a WebGPU browser
// (restart the dev server first — it does not hot-reload engine changes).

import { vec3, vec4 } from '@retro-engine/math';
import type { Plugin } from '@retro-engine/engine';
import {
  AmbientLight,
  Camera3d,
  Commands,
  Cuboid,
  EnvironmentMapLight,
  EnvironmentMapPlugin,
  Image,
  Images,
  Light3dPlugin,
  MaterialPlugin,
  Mesh3d,
  Meshes,
  ResMut,
  Skybox,
  SkyboxPlugin,
  Sphere,
  StandardMaterial,
  StandardMaterialPlugin,
  Transform,
} from '@retro-engine/engine';

type Vec4Lit = Float32Array & { readonly length: 4 };
const rgba = (r: number, g: number, b: number): Vec4Lit =>
  vec4.create(r, g, b, 1) as unknown as Vec4Lit;

const FACE_COLORS: ReadonlyArray<readonly [number, number, number]> = [
  [255, 40, 40], // +X red
  [40, 220, 220], // -X cyan
  [60, 220, 60], // +Y green (up)
  [220, 60, 220], // -Y magenta (down)
  [60, 90, 240], // +Z blue
  [235, 220, 50], // -Z yellow
];
const FACE = 16;

// Procedural equirectangular image (top-left origin): green cap up, magenta cap
// down, four longitude bands in between. Lets `?src=equirect` exercise the
// equirect→cube conversion path with a recognizable, non-HDR source.
const makeEquirect = (): Image => {
  const W = 256;
  const H = 128;
  const data = new Uint8Array(W * H * 4);
  const bands: ReadonlyArray<readonly [number, number, number]> = [
    [235, 220, 50], // u≈0.25 → -Z yellow
    [255, 40, 40], // u≈0.50 → +X red
    [60, 90, 240], // u≈0.75 → +Z blue
    [40, 220, 220], // u≈0.00/1.0 → -X cyan
  ];
  for (let y = 0; y < H; y++) {
    const v = y / (H - 1);
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      let c: readonly [number, number, number];
      if (v < 0.25) c = [60, 220, 60]; // +Y green (up)
      else if (v > 0.75) c = [220, 60, 220]; // -Y magenta (down)
      else c = bands[Math.floor((x / W) * 4) % 4]!;
      data[o] = c[0];
      data[o + 1] = c[1];
      data[o + 2] = c[2];
      data[o + 3] = 255;
    }
  }
  return Image.fromBytes({
    data,
    format: 'rgba8unorm',
    colorSpace: 'srgb',
    width: W,
    height: H,
    dimension: '2d',
    label: 'ibl-equirect',
  });
};

const makeFaceCube = (): Image => {
  const texels = FACE * FACE;
  const data = new Uint8Array(6 * texels * 4);
  for (let face = 0; face < 6; face++) {
    const [r, g, b] = FACE_COLORS[face]!;
    const base = face * texels * 4;
    for (let i = 0; i < texels; i++) {
      const o = base + i * 4;
      data[o] = r!;
      data[o + 1] = g!;
      data[o + 2] = b!;
      data[o + 3] = 255;
    }
  }
  return Image.fromBytes({
    data,
    format: 'rgba8unorm',
    colorSpace: 'srgb',
    width: FACE,
    height: FACE,
    depthOrArrayLayers: 6,
    dimension: 'cube',
    label: 'ibl-face-cube',
  });
};

/** Playground showcase for image-based lighting from an environment cubemap. */
export const environmentShowcasePlugin: Plugin = (app) => {
  const log = app.logger.child('ibl-showcase');
  const pbr = new MaterialPlugin(StandardMaterial);
  app.addPlugin(new StandardMaterialPlugin());
  app.addPlugin(pbr);
  // Near-black ambient so the only meaningful indirect light is the environment.
  app.insertResource(new AmbientLight({ color: vec3.create(0, 0, 0), brightness: 0 }));
  app.addPlugin(new Light3dPlugin());
  app.addPlugin(new SkyboxPlugin());
  app.addPlugin(new EnvironmentMapPlugin());

  app.addSystem(
    'startup',
    [Commands, ResMut(Meshes), ResMut(pbr.Materials), ResMut(Images)],
    (cmd, meshes, materials, images) => {
      const equirect =
        typeof window !== 'undefined' &&
        new URLSearchParams(window.location.search).get('src') === 'equirect';
      const cube = images.add(equirect ? makeEquirect() : makeFaceCube());
      log.info(`environment source = ${equirect ? 'equirectangular 2D' : 'cube'}`);
      const sphere = meshes.add(new Sphere({ radius: 0.7 }).mesh().build());

      // Five metallic spheres, roughness 0 → 1 left to right.
      const COUNT = 5;
      for (let i = 0; i < COUNT; i++) {
        const roughness = i / (COUNT - 1);
        const mat = materials.add(
          new StandardMaterial({ baseColor: rgba(0.95, 0.95, 0.95), metallic: 1, roughness }),
        );
        const tr = new Transform();
        tr.translation = vec3.create((i - (COUNT - 1) / 2) * 1.7, 0.4, 0);
        cmd.spawn(new Mesh3d(sphere), new pbr.MeshMaterial3d(mat), tr);
      }

      // A matte dielectric sphere up front to read the diffuse irradiance tint.
      const matte = materials.add(
        new StandardMaterial({ baseColor: rgba(0.8, 0.8, 0.8), metallic: 0, roughness: 1 }),
      );
      const matteT = new Transform();
      matteT.translation = vec3.create(0, 0.4, 2.2);
      cmd.spawn(new Mesh3d(sphere), new pbr.MeshMaterial3d(matte), matteT);

      const ground = meshes.add(new Cuboid({ halfSize: [12, 0.1, 12] }).mesh().build());
      const groundMat = materials.add(
        new StandardMaterial({ baseColor: rgba(0.5, 0.5, 0.5), metallic: 0.1, roughness: 0.4 }),
      );
      const groundT = new Transform();
      groundT.translation = vec3.create(0, -0.4, 0);
      cmd.spawn(new Mesh3d(ground), new pbr.MeshMaterial3d(groundMat), groundT);

      const camT = new Transform();
      camT.translation = vec3.create(0, 1.2, 6);
      cmd.spawn(
        ...Camera3d({ transform: camT, hdr: true }),
        new EnvironmentMapLight({ environmentMap: cube }),
        new Skybox({ image: cube }),
      );

      log.info('spawned metallic roughness sweep + matte sphere lit by the cube environment');
    },
  );
};
