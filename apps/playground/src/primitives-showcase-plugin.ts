// Visual verification harness for Phase 7's material system.
//
// Spawns 15 mesh primitives as `Mesh3d + MeshMaterial3d<UnlitMaterial>`
// bundles. The engine's Core3d phase trio + MaterialPlugin<UnlitMaterial>
// draws every entity — no custom shader, no custom pipeline, no custom
// render-graph node, no manual depth texture. This file is the Phase 7
// boundary check (ADR-0028): the showcase previously ran ~440 LOC of
// hand-rolled draw plumbing; with materials in tree, it shrinks to one
// startup system + one per-frame rotation system.

import { quat, vec3 } from '@retro-engine/math';
import { TextureUsage } from '@retro-engine/renderer-core';
import type { Plugin } from '@retro-engine/engine';
import {
  Annulus,
  Camera3d,
  Capsule3d,
  Circle,
  Commands,
  Cone,
  ConicalFrustum,
  Cuboid,
  Cylinder,
  Ellipse,
  MaterialPlugin,
  Mesh3d,
  Meshes,
  Plane3d,
  Query,
  Rectangle,
  RegularPolygon,
  ResMut,
  Sphere,
  Tetrahedron,
  Time,
  Torus,
  Transform,
  Triangle,
  UnlitMaterial,
  UnlitMaterialPlugin,
  type Meshable,
} from '@retro-engine/engine';

/** Marker component: an entity that rotates each frame. */
class Spin {
  constructor(public readonly speed: number = 0.7) {}
}

interface Placement {
  meshable: Meshable;
  position: readonly [number, number, number];
  color: readonly [number, number, number];
  rotates: boolean;
}

const placePrimitives = (): Placement[] => {
  // 16 cells in a 4 wide × 4 deep grid; column spacing 1.8, row spacing 2.0.
  const cell = (col: number, row: number): [number, number, number] => [
    (col - 1.5) * 1.8,
    0,
    (row - 1.5) * 2.0,
  ];
  return [
    { meshable: new Cuboid(), position: cell(0, 0), color: [0.95, 0.55, 0.45], rotates: true },
    { meshable: new Sphere(), position: cell(1, 0), color: [0.55, 0.85, 0.6], rotates: false },
    { meshable: new Sphere(), position: cell(2, 0), color: [0.45, 0.7, 0.95], rotates: false },
    { meshable: new Cylinder(), position: cell(3, 0), color: [0.95, 0.85, 0.4], rotates: true },
    { meshable: new Capsule3d({ radius: 0.3, halfLength: 0.4 }), position: cell(0, 1), color: [0.85, 0.45, 0.85], rotates: true },
    { meshable: new Torus({ majorRadius: 0.55, minorRadius: 0.18 }), position: cell(1, 1), color: [0.45, 0.95, 0.9], rotates: true },
    { meshable: new Plane3d({ halfSize: [0.6, 0.6] }), position: cell(2, 1), color: [0.6, 0.6, 0.95], rotates: false },
    { meshable: new Cone(), position: cell(3, 1), color: [0.95, 0.7, 0.35], rotates: true },
    { meshable: new Tetrahedron({ circumradius: 0.6 }), position: cell(0, 2), color: [0.5, 0.95, 0.5], rotates: true },
    { meshable: new ConicalFrustum({ radiusTop: 0.25, radiusBottom: 0.5, height: 1 }), position: cell(1, 2), color: [0.95, 0.5, 0.55], rotates: true },
    { meshable: new Rectangle({ halfSize: [0.55, 0.4] }), position: cell(2, 2), color: [0.8, 0.4, 0.4], rotates: false },
    { meshable: new Circle({ radius: 0.45 }), position: cell(3, 2), color: [0.4, 0.8, 0.4], rotates: false },
    { meshable: new Annulus({ innerRadius: 0.22, outerRadius: 0.45 }), position: cell(0, 3), color: [0.4, 0.6, 0.95], rotates: false },
    { meshable: new RegularPolygon({ circumradius: 0.45, sides: 5 }), position: cell(1, 3), color: [0.95, 0.85, 0.5], rotates: false },
    { meshable: new Triangle({ a: [-0.5, -0.4], b: [0.5, -0.4], c: [0, 0.5] }), position: cell(2, 3), color: [0.85, 0.55, 0.9], rotates: false },
    { meshable: new Ellipse({ halfWidth: 0.55, halfHeight: 0.3 }), position: cell(3, 3), color: [0.5, 0.95, 0.85], rotates: false },
  ];
};

/**
 * Playground showcase: spawn the engine's 15 mesh primitives in a 4×4 grid,
 * each backed by a `UnlitMaterial` with a tint color. Rotating shapes spin
 * around the Y axis each frame to show their 3D-ness.
 *
 * The 436-LOC pre-Phase-7 version of this plugin owned a custom shader,
 * pipeline layout, render sub-graph, depth texture, and per-mesh model bind
 * groups. With the material system in tree (ADR-0028), all of that becomes
 * engine concerns: `MaterialPlugin<UnlitMaterial>` builds the pipeline,
 * `Camera3d()` defaults `depthTarget` to `'auto'` so the engine allocates
 * per-camera depth textures, and the Core3d phase trio draws everything
 * through its standard pass. What's left is the data — placements +
 * color tints + a rotation system.
 */
export const primitivesShowcasePlugin: Plugin = (app) => {
  const log = app.logger.child('showcase');
  const unlitPlugin = new MaterialPlugin(UnlitMaterial);
  app.addPlugin(new UnlitMaterialPlugin());
  app.addPlugin(unlitPlugin);

  // Spin every Spin-marked entity around its Y axis each frame.
  app.addSystem('update', [Query([Transform, Spin]), ResMut(Time)], (rotators, time) => {
    const dt = time.virtual.delta;
    for (const [transform, spin] of rotators) {
      const delta = quat.create();
      quat.fromAxisAngle(vec3.create(0, 1, 0), spin.speed * dt, delta);
      quat.multiply(delta, transform.rotation, transform.rotation);
    }
  });

  app.addSystem(
    'startup',
    [Commands, ResMut(Meshes), ResMut(unlitPlugin.Materials)],
    (cmd, meshes, materials) => {
      // One shared 1×1 white texture + one shared linear sampler. The
      // UnlitMaterial schema requires both; users without per-material
      // textures fall back to a default like this.
      const whiteTexture = app.renderer.createTexture({
        label: 'showcase-white',
        width: 1,
        height: 1,
        format: 'rgba8unorm',
        usage: TextureUsage.TEXTURE_BINDING | TextureUsage.COPY_DST,
      });
      const whitePixels = new Uint8Array([0xff, 0xff, 0xff, 0xff]);
      app.renderer.writeTexture(
        { texture: whiteTexture },
        whitePixels,
        { bytesPerRow: 4 },
        { width: 1, height: 1, depthOrArrayLayers: 1 },
      );
      const whiteView = whiteTexture.createView();
      const sampler = app.renderer.createSampler({
        label: 'showcase-sampler',
        magFilter: 'linear',
        minFilter: 'linear',
      });

      for (const place of placePrimitives()) {
        const meshHandle = meshes.add(place.meshable.mesh().build());
        const materialHandle = materials.add(
          new UnlitMaterial({
            color: new Float32Array([
              place.color[0],
              place.color[1],
              place.color[2],
              1,
            ]) as unknown as Float32Array & { readonly length: 4 },
            colorTexture: whiteView,
            colorSampler: sampler,
          }),
        );
        const transform = new Transform();
        transform.translation = vec3.create(...place.position);
        const components: object[] = [
          new Mesh3d(meshHandle),
          new unlitPlugin.MeshMaterial3d(materialHandle),
          transform,
        ];
        if (place.rotates) components.push(new Spin());
        cmd.spawn(...components);
      }

      // Camera at (0, 4, 7), tilted ~30° downward.
      const camTransform = new Transform();
      camTransform.translation = vec3.create(0, 4, 7);
      quat.fromAxisAngle(vec3.create(1, 0, 0), -Math.PI / 6, camTransform.rotation);
      cmd.spawn(...Camera3d({ transform: camTransform }));

      log.info('spawned 16 primitives backed by UnlitMaterial');
    },
  );
};
