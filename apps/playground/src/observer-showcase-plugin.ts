// Device check for inline observer binding (ADR-0068): a single cube is built
// from a scene that (a) embeds the `Cube` template by name and (b) binds the
// `toggleColor` observer handler by name. Nothing code-shaped is serialized —
// the scene references the handler name, and the registered handler carries the
// event it observes (`Poke`) plus the body to run. Pressing Space triggers a
// `Poke` at the cube; the scene-bound observer fires through the live runtime
// and toggles the cube's material color, proving the binding round-tripped
// through JSON into a working observer.
//
// Open ?mode=observers in a WebGPU browser (restart the dev server first — it
// does not hot-reload engine changes). Press Space to recolor the cube.

import { quat, vec3, vec4 } from '@retro-engine/math';
import { t } from '@retro-engine/reflect';
import type { Entity } from '@retro-engine/ecs';
import type { Plugin, SceneData } from '@retro-engine/engine';
import {
  Camera3d,
  Commands,
  Cuboid,
  defineObserverHandler,
  defineTemplate,
  MaterialPlugin,
  Mesh3d,
  Meshes,
  Query,
  ResMut,
  SCENE_FORMAT_VERSION,
  spawnScene,
  Time,
  Transform,
  Trigger,
  UnlitMaterial,
  UnlitMaterialPlugin,
  Visibility,
} from '@retro-engine/engine';

/** Event fired at the cube when the user pokes it. */
class Poke {}

/**
 * Playground showcase for inline observer binding: a scene attaches a named
 * observer handler to its entity, and triggering the event recolors the cube.
 */
export const observerShowcasePlugin: Plugin = (app) => {
  const log = app.logger.child('observer-showcase');
  const unlit = new MaterialPlugin(UnlitMaterial);
  app.addPlugin(new UnlitMaterialPlugin());
  app.addPlugin(unlit);

  let target: Entity | undefined;
  let wantPoke = false;

  // Space pokes the cube. The flag is drained by the update system below so the
  // trigger rides the command buffer rather than firing off the input thread.
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', (e) => {
      if (e.key === ' ') {
        wantPoke = true;
        log.info('poke! (press Space to recolor the scene-bound cube)');
      }
    });
  }

  app.addSystem(
    'startup',
    [Commands, ResMut(Meshes), ResMut(unlit.Materials)],
    (cmd, meshes, materials) => {
      const cube = meshes.add(new Cuboid().mesh().build());
      const calm = materials.add(new UnlitMaterial({ color: vec4.create(0.3, 0.8, 1, 1) }));
      const poked = materials.add(new UnlitMaterial({ color: vec4.create(1, 0.4, 0.2, 1) }));

      // The recipe: a positioned, cyan, renderable cube. Handles are captured
      // live, so the scene path never has to serialize them.
      app.registerTemplate(
        defineTemplate({
          name: 'Cube',
          params: { position: t.vec3.default(() => vec3.create(0, 0, 0)) },
          build: ({ position }) => [
            new Transform(position),
            new Mesh3d(cube),
            new unlit.MeshMaterial3d(calm),
            new Visibility('Visible'),
          ],
        }),
      );

      // The behavior, registered by name. The scene attaches it by that name
      // alone; the handler carries the event (`Poke`) and the body. On each Poke
      // it toggles the cube's material — proving a scene-bound observer fired
      // through the live runtime.
      let lit = false;
      app.registerObserverHandler(
        defineObserverHandler({
          name: 'toggleColor',
          event: Poke,
          params: [Trigger(Poke), Commands] as const,
          run: (trigger, observerCmd) => {
            const entity = trigger.entity();
            if (entity === undefined) return;
            lit = !lit;
            observerCmd.entity(entity).insert(new unlit.MeshMaterial3d(lit ? poked : calm));
          },
        }),
      );

      // A scene whose single entity is built from the `Cube` template and binds
      // the `toggleColor` handler by name — all plain JSON.
      const sceneSrc: SceneData = {
        version: SCENE_FORMAT_VERSION,
        entities: [
          {
            id: 0,
            components: [],
            templates: [{ template: 'Cube', params: { position: [0, 0, 0] } }],
            observers: [{ handler: 'toggleColor' }],
          },
        ],
      };
      const scene: SceneData = JSON.parse(JSON.stringify(sceneSrc)) as SceneData;
      const idMap = spawnScene(app, scene);
      target = idMap.get(0);
      log.info(
        `observer showcase: spawned ${idMap.size} cube with a scene-bound observer (press Space to poke)`,
      );

      // Camera framing the cube.
      const camT = new Transform();
      camT.translation = vec3.create(0, 0.4, 5);
      quat.fromAxisAngle(vec3.create(1, 0, 0), -0.06, camT.rotation);
      cmd.spawn(...Camera3d({ transform: camT }));
    },
  );

  // Drain the input flag: fire a Poke trigger at the cube when Space was pressed.
  app.addSystem('update', [Commands], (cmd) => {
    if (!wantPoke || target === undefined) return;
    wantPoke = false;
    cmd.entity(target).trigger(new Poke());
  });

  // Gentle spin so the recolor reads on a 3D cube.
  app.addSystem('update', [Query([Transform, Mesh3d]), ResMut(Time)], (cubes, time) => {
    for (const [entity, transform] of cubes.entries()) {
      quat.fromAxisAngle(vec3.create(0, 1, 0), time.virtual.elapsed * 0.6, transform.rotation);
      app.world.markChanged(entity, Transform);
    }
  });
};
