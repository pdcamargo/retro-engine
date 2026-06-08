// Device check for prefab templates & patches (ADR-0067): a `Cube` template is
// registered, spawned twice with different position params, and one instance is
// patched ("Damaged") to a red material — proving spawn-with-params and patch.
// A third cube comes from a serialized scene that embeds the template by name
// with a field-level Transform override, proving scene-embed + per-instance
// override round-trip through JSON.
//
// Open ?mode=prefab in a WebGPU browser (restart the dev server first — it does
// not hot-reload engine changes). Left cube = template default (cyan); right cube
// = patched (red); top cube = scene-embedded with a scaled-up Transform override.

import { quat, vec3, vec4 } from '@retro-engine/math';
import { t } from '@retro-engine/reflect';
import type { Plugin, SceneData } from '@retro-engine/engine';
import {
  applyTemplate,
  Camera3d,
  Commands,
  Cuboid,
  defineTemplate,
  MaterialPlugin,
  Mesh3d,
  Meshes,
  Query,
  ResMut,
  SCENE_FORMAT_VERSION,
  spawnScene,
  spawnTemplate,
  Time,
  Transform,
  UnlitMaterial,
  UnlitMaterialPlugin,
  Visibility,
} from '@retro-engine/engine';

/**
 * Playground showcase for prefab templates & patches: spawn from a template,
 * patch an existing instance, and spawn a third instance from a scene that
 * embeds the template by name with a field-level override.
 */
export const prefabShowcasePlugin: Plugin = (app) => {
  const log = app.logger.child('prefab-showcase');
  const unlit = new MaterialPlugin(UnlitMaterial);
  app.addPlugin(new UnlitMaterialPlugin());
  app.addPlugin(unlit);

  app.addSystem(
    'startup',
    [Commands, ResMut(Meshes), ResMut(unlit.Materials)],
    (cmd, meshes, materials) => {
      const cube = meshes.add(new Cuboid().mesh().build());
      const cyan = materials.add(new UnlitMaterial({ color: vec4.create(0.3, 0.8, 1, 1) }));
      const red = materials.add(new UnlitMaterial({ color: vec4.create(1, 0.25, 0.25, 1) }));

      // The recipe: a positioned, cyan, renderable cube. `position` is a param so
      // each instance places itself; the handles are captured live, so the scene
      // path never has to serialize them.
      app.registerTemplate(
        defineTemplate({
          name: 'Cube',
          params: { position: t.vec3.default(() => vec3.create(0, 0, 0)) },
          build: ({ position }) => [
            new Transform(position),
            new Mesh3d(cube),
            new unlit.MeshMaterial3d(cyan),
            new Visibility('Visible'),
          ],
        }),
      );
      // A patch: swap just the material. Applied to an existing cube, it overwrites
      // MeshMaterial3d and leaves Transform / Mesh3d untouched.
      const Damaged = app.registerTemplate(
        defineTemplate({
          name: 'Damaged',
          build: () => [new unlit.MeshMaterial3d(red)],
        }),
      );

      // Spawn two from the template; patch the right one to "damaged" (red).
      spawnTemplate(app, 'Cube', { position: vec3.create(-1.6, 0, 0) });
      const right = spawnTemplate(app, 'Cube', { position: vec3.create(1.6, 0, 0) });
      applyTemplate(app, right, Damaged);

      // A third cube from a serialized scene: it references the template by name,
      // positions it via params, and scales it via a field-level Transform
      // override — all plain JSON.
      const sceneSrc: SceneData = {
        version: SCENE_FORMAT_VERSION,
        entities: [
          {
            id: 0,
            components: [],
            templates: [
              {
                template: 'Cube',
                params: { position: [0, 1.7, 0] },
                overrides: [{ type: 'Transform', data: { scale: [1.6, 1.6, 1.6] } }],
              },
            ],
          },
        ],
      };
      const scene: SceneData = JSON.parse(JSON.stringify(sceneSrc)) as SceneData;
      const idMap = spawnScene(app, scene);
      log.info(`prefab showcase: spawned ${idMap.size} cube from an embedded template (scaled override)`);

      // Camera framing the three cubes.
      const camT = new Transform();
      camT.translation = vec3.create(0, 0.6, 7);
      quat.fromAxisAngle(vec3.create(1, 0, 0), -0.08, camT.rotation);
      cmd.spawn(...Camera3d({ transform: camT }));
    },
  );

  // Spin each cube about Y so the patch (color) and the override (scale) read
  // clearly in 3D.
  app.addSystem('update', [Query([Transform, Mesh3d]), ResMut(Time)], (cubes, time) => {
    for (const [entity, transform] of cubes.entries()) {
      quat.fromAxisAngle(vec3.create(0, 1, 0), time.virtual.elapsed * 0.7, transform.rotation);
      app.world.markChanged(entity, Transform);
    }
  });
};
