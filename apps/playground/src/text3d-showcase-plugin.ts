// Visual harness for world-space 3D text (ADR-0155).
//
// Spawns a `Text` (3D) on the XY plane at the origin, drawn through a perspective
// `Camera3d` and depth-tested against the scene: an opaque unlit cube sits between
// the camera and the right half of the label, so it occludes those glyphs — the
// proof that 3D text writes into the depth-tested transparent phase. Uses the
// built-in default font (no asset on disk). Open `?mode=text3d` in a WebGPU
// browser; `window.__text3d.instances` reports the packed glyph count.

import { quat, vec3, vec4 } from '@retro-engine/math';
import type { Plugin } from '@retro-engine/engine';
import {
  Camera3d,
  Commands,
  Cuboid,
  installDefaultFont,
  MaterialPlugin,
  Mesh3d,
  Meshes,
  Query,
  ResMut,
  Text,
  Text3dInstanceBuffer,
  TextPlugin,
  Time,
  Transform,
  UnlitMaterial,
  UnlitMaterialPlugin,
} from '@retro-engine/engine';

/** Marker: rotate this entity about its Y axis each frame. */
class SpinY {
  constructor(public readonly speed: number = 0.5) {}
}

/** Playground showcase: a world-space `Text` occluded by a cube under a 3D camera. */
export const text3dShowcasePlugin: Plugin = (app) => {
  const log = app.logger.child('text3d-showcase');
  app.addPlugin(new TextPlugin());
  const unlit = new MaterialPlugin(UnlitMaterial);
  app.addPlugin(new UnlitMaterialPlugin());
  app.addPlugin(unlit);
  const font = installDefaultFont(app);

  app.addSystem(
    'startup',
    [Commands, ResMut(Meshes), ResMut(unlit.Materials)],
    (cmd, meshes, materials) => {
      // World-space label at the origin. fontSize is in layout "pixels", so scale
      // it down to a sensible world size (~2.5 units wide).
      const textT = new Transform();
      textT.scale = vec3.create(0.02, 0.02, 0.02);
      cmd.spawn(
        new Text({ text: 'WORLD 3D', font, fontSize: 96, color: vec4.create(1, 0.95, 0.4, 1) }),
        textT,
      );

      // Opaque cube between the camera (+Z) and the right half of the label → it
      // occludes those glyphs, proving the text is depth-tested.
      const cube = meshes.add(new Cuboid({ halfSize: [0.6, 0.6, 0.6] }).mesh().build());
      const cubeMat = materials.add(new UnlitMaterial({ color: vec4.create(0.25, 0.6, 1, 1) }));
      cmd.spawn(new Mesh3d(cube), new unlit.MeshMaterial3d(cubeMat), new Transform(vec3.create(0.9, 0, 2)), new SpinY());

      // Perspective camera on +Z looking down −Z at the origin.
      const camT = new Transform();
      camT.translation = vec3.create(0, 0, 5);
      cmd.spawn(...Camera3d({ transform: camT }));
      log.info('spawned a world-space Text occluded by a cube under a Camera3d');
    },
    { label: 'text3d-showcase-setup' },
  );

  app.addSystem(
    'update',
    [Query([Transform, SpinY]), ResMut(Time)],
    (spinners, time) => {
      const dt = time.virtual.delta;
      for (const [entity, transform, spin] of spinners.entries()) {
        const delta = quat.create();
        quat.fromAxisAngle(vec3.create(0, 1, 0), spin.speed * dt, delta);
        quat.multiply(delta, transform.rotation, transform.rotation);
        app.world.markChanged(entity, Transform);
      }
    },
    { label: 'text3d-showcase-spin' },
  );

  app.addSystem(
    'update',
    [ResMut(Text3dInstanceBuffer)],
    (buf) => {
      if (typeof window === 'undefined') return;
      (window as unknown as { __text3d: { instances: number } }).__text3d = { instances: buf.count };
    },
    { label: 'text3d-showcase-probe' },
  );
};
