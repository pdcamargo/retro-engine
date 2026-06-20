// Visual verification harness for the skybox pass (increment 1 of the
// environment-map work). A distinctly-colored six-face cube is drawn as the
// background behind a PBR sphere + ground, so three things are checkable at a
// glance: the sky shows in empty pixels, opaque geometry occludes it, and each
// cube face lands in the expected world direction (so ray reconstruction and
// rotation are correct).
//
// Face colors: +X red, -X cyan, +Y green (up), -Y magenta (down), +Z blue,
// -Z yellow. A slow yaw spin (press nothing — it animates) proves the rotation
// knob feeds the sampler.
//
// GPU shading is not headless-verifiable; open ?mode=skybox in a WebGPU browser
// (restart the dev server first — it does not hot-reload engine changes).

import { quat, vec3, vec4 } from '@retro-engine/math';
import type { Plugin } from '@retro-engine/engine';
import {
  AmbientLight,
  Camera3d,
  Commands,
  Cuboid,
  DirectionalLight3d,
  Image,
  Images,
  Light3dPlugin,
  MaterialPlugin,
  Mesh3d,
  Meshes,
  Query,
  ResMut,
  Skybox,
  SkyboxPlugin,
  Sphere,
  StandardMaterial,
  StandardMaterialPlugin,
  Time,
  Transform,
} from '@retro-engine/engine';

type Vec4Lit = Float32Array & { readonly length: 4 };
const rgba = (r: number, g: number, b: number): Vec4Lit =>
  vec4.create(r, g, b, 1) as unknown as Vec4Lit;

// Six solid-colored faces in WebGPU cube-layer order (+X, -X, +Y, -Y, +Z, -Z).
const FACE_COLORS: ReadonlyArray<readonly [number, number, number]> = [
  [255, 40, 40], // +X red
  [40, 220, 220], // -X cyan
  [60, 220, 60], // +Y green (up)
  [220, 60, 220], // -Y magenta (down)
  [60, 90, 240], // +Z blue
  [235, 220, 50], // -Z yellow
];

const FACE = 16;

/** Build a six-face solid-colored cube `Image` (no asset loader needed). */
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
    label: 'skybox-face-cube',
  });
};

/**
 * Playground showcase for the skybox pass: a colored cube background behind a
 * PBR sphere and ground, with the sky slowly yawing to prove the rotation knob.
 */
export const skyboxShowcasePlugin: Plugin = (app) => {
  const log = app.logger.child('skybox-showcase');
  const pbr = new MaterialPlugin(StandardMaterial);
  app.addPlugin(new StandardMaterialPlugin());
  app.addPlugin(pbr);
  app.insertResource(new AmbientLight({ color: vec3.create(0.6, 0.65, 0.8), brightness: 0.2 }));
  app.addPlugin(new Light3dPlugin());
  app.addPlugin(new SkyboxPlugin());

  // Slowly yaw the skybox so the rotation field is visibly exercised.
  app.addSystem('update', [Query([Skybox]), ResMut(Time)], (skies, time) => {
    const t = time.virtual.elapsed;
    for (const [entity, sky] of skies.entries()) {
      quat.fromAxisAngle(vec3.create(0, 1, 0), t * 0.25, sky.rotation);
      app.world.markChanged(entity, Skybox);
    }
  });

  app.addSystem(
    'startup',
    [Commands, ResMut(Meshes), ResMut(pbr.Materials), ResMut(Images)],
    (cmd, meshes, materials, images) => {
      const skyCube = images.add(makeFaceCube());

      const sphere = meshes.add(new Sphere({ radius: 1.2 }).mesh().build());
      const sphereMat = materials.add(
        new StandardMaterial({ baseColor: rgba(0.9, 0.9, 0.9), metallic: 0.1, roughness: 0.5 }),
      );
      cmd.spawn(new Mesh3d(sphere), new pbr.MeshMaterial3d(sphereMat), new Transform());

      const ground = meshes.add(new Cuboid({ halfSize: [12, 0.1, 12] }).mesh().build());
      const groundMat = materials.add(
        new StandardMaterial({ baseColor: rgba(0.3, 0.3, 0.32), metallic: 0, roughness: 0.9 }),
      );
      const groundT = new Transform();
      groundT.translation = vec3.create(0, -1.3, 0);
      cmd.spawn(new Mesh3d(ground), new pbr.MeshMaterial3d(groundMat), groundT);

      const sunT = new Transform();
      quat.fromAxisAngle(vec3.create(1, 0, 0), -0.7, sunT.rotation);
      quat.rotateY(sunT.rotation, 0.5, sunT.rotation);
      cmd.spawn(new DirectionalLight3d({ color: vec3.create(1, 0.97, 0.9), intensity: 2.5 }), sunT);

      const camT = new Transform();
      camT.translation = vec3.create(0, 1.5, 6);
      quat.fromAxisAngle(vec3.create(1, 0, 0), -0.12, camT.rotation);
      cmd.spawn(...Camera3d({ transform: camT, hdr: true }), new Skybox({ image: skyCube }));

      log.info('spawned colored-cube skybox behind a PBR sphere + ground');
    },
  );
};
