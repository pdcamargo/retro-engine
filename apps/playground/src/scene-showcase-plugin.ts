// Device check for the scene lifecycle: a scene asset, gated behind a `States`
// value, spawns on enter and tears down on exit — live.
//
// On startup a real renderable graph (a named root with one unlit-cube child,
// linked by a Parent edge) is serialized to a `Scene` and added to the live
// `Scenes` store, then bound to the `Showing` state via `app.addScene`. The
// engine spawns a `SceneRoot` on `OnEnter(Showing)`; the reactor instantiates
// the graph under it once the asset is ready, and despawning the root on
// `OnExit(Showing)` tears the whole subtree down.
//
// The scene root spins so its child orbits — proof the hierarchy was rebuilt
// from the serialized Parent edge. Press Space to toggle Showing/Hidden and
// watch the cube spawn and disappear. The camera lives OUTSIDE the scene, so it
// survives every transition.
//
// Open ?mode=scene in a WebGPU browser (restart the dev server first — it does
// not hot-reload engine changes).

import { quat, vec3, vec4 } from '@retro-engine/math';
import { World } from '@retro-engine/ecs';
import { asAssetIndex, generateAssetGuid, makeHandle } from '@retro-engine/assets';
import type { Plugin, SceneData } from '@retro-engine/engine';
import {
  AppTypeRegistry,
  AssetPlugin,
  Camera3d,
  Commands,
  Cuboid,
  MaterialPlugin,
  Mesh,
  Mesh3d,
  Meshes,
  Name,
  NextState,
  Parent,
  Query,
  Res,
  ResMut,
  Scene,
  Scenes,
  ScenePlugin,
  serializeWorld,
  State,
  Time,
  Transform,
  UnlitMaterial,
  UnlitMaterialPlugin,
  Visibility,
} from '@retro-engine/engine';

/** Scene-demo state: the scene exists only while `Showing`. */
class SceneDemoState {
  static readonly Showing = new SceneDemoState('Showing');
  static readonly Hidden = new SceneDemoState('Hidden');
  constructor(public readonly name: string) {}
}

/**
 * Playground showcase that loads a scene as an asset and gates it behind a
 * `States` value — spawning on enter and tearing down on exit, toggled live.
 */
export const sceneShowcasePlugin: Plugin = (app) => {
  const log = app.logger.child('scene-showcase');
  const unlit = new MaterialPlugin(UnlitMaterial);
  app.addPlugin(new AssetPlugin());
  app.addPlugin(new UnlitMaterialPlugin());
  app.addPlugin(unlit);
  app.addPlugin(new ScenePlugin());
  app.initState(SceneDemoState, SceneDemoState.Showing);

  app.addSystem(
    'startup',
    [Commands, ResMut(Meshes), ResMut(unlit.Materials), ResMut(Scenes)],
    (cmd, meshes, materials, scenes) => {
      // Real assets in the live stores — what the respawned scene renders.
      const cuboid = meshes.add(new Cuboid().mesh().build());
      const material = materials.add(new UnlitMaterial({ color: vec4.create(0.3, 0.8, 1, 1) }));
      const meshGuid = generateAssetGuid();
      const matGuid = generateAssetGuid();

      // Author the scene graph in a throwaway world, serialize it to portable
      // data (handles persist by GUID), and register it as a Scene asset.
      const registry = app.getResource(AppTypeRegistry)!.registry;
      const source = new World();
      const root = source.spawn(new Transform(), new Name('demo-scene-root'));
      source.spawn(
        new Transform(vec3.create(2, 0, 0)),
        new Mesh3d(makeHandle<Mesh>(cuboid.index, meshGuid)),
        new unlit.MeshMaterial3d(makeHandle<UnlitMaterial>(material.index, matGuid)),
        new Visibility('Visible'),
        new Parent(root),
      );
      const data: SceneData = serializeWorld(source, registry, { handleRef: (_t, h) => h.guid });
      const handle = scenes.add(new Scene(data));

      // Persistent camera, outside the scene — survives every state transition.
      const camT = new Transform();
      camT.translation = vec3.create(0, 2.5, 8);
      quat.fromAxisAngle(vec3.create(1, 0, 0), -0.28, camT.rotation);
      cmd.spawn(...Camera3d({ transform: camT }));

      // Bind the scene to Showing — spawns on enter, tears down on exit. The
      // resolver maps each serialized GUID back to its live store handle.
      app.addScene(SceneDemoState.Showing, handle, {
        resolveHandle: (_t, g) =>
          g === meshGuid ? cuboid : g === matGuid ? material : makeHandle(asAssetIndex(0)),
      });
      log.info('scene bound to Showing — press Space to toggle spawn/teardown');
    },
  );

  // Press Space to flip the desired visibility; a system drives the transition.
  let wantShowing = true;
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', (e) => {
      if (e.key === ' ') {
        wantShowing = !wantShowing;
        log.info(`scene ${wantShowing ? 'SHOWING' : 'HIDDEN'} (press Space to toggle)`);
      }
    });
  }
  app.addSystem(
    'update',
    [Res(State(SceneDemoState)), ResMut(NextState(SceneDemoState))],
    (state, next) => {
      const target = wantShowing ? SceneDemoState.Showing : SceneDemoState.Hidden;
      if (state.current !== undefined && state.current !== target && next.value === undefined) {
        next.set(target);
      }
    },
  );

  // Spin the scene's root so its offset child orbits — a live proof the
  // hierarchy was rebuilt from the serialized Parent edge.
  app.addSystem('update', [Query([Transform, Name]), ResMut(Time)], (roots, time) => {
    for (const [entity, transform, name] of roots.entries()) {
      if (name.value !== 'demo-scene-root') continue;
      quat.fromAxisAngle(vec3.create(0, 1, 0), time.virtual.elapsed * 0.8, transform.rotation);
      app.world.markChanged(entity, Transform);
    }
  });
};
