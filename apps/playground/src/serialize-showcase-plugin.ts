// End-to-end device check for reflection serialization: JSON → live world.
//
// A real engine graph (a named root with one renderable child, linked by a
// Parent edge) is authored in a throwaway `World`, serialized to JSON (dumped
// to the console), then spawned back into the LIVE world through `spawnScene`
// and rendered. The root spins, so the child — reparented purely from the
// serialized Parent edge — orbits it: a live proof that the hierarchy and the
// child's GlobalTransform were rebuilt from JSON, not carried over from the
// source graph (which never leaves this function).
//
// The console shows the serialized JSON, then a post-load confirmation object
// read back out of the live world (hierarchy wired, Children rebuilt, handle
// resolved by GUID, GlobalTransform recomputed).
//
// Open ?mode=serialize in a WebGPU browser (restart the dev server first — it
// does not hot-reload engine changes).

import { quat, vec3, vec4 } from '@retro-engine/math';
import { World } from '@retro-engine/ecs';
import { asAssetIndex, generateAssetGuid, makeHandle } from '@retro-engine/assets';
import type { Plugin, SceneData } from '@retro-engine/engine';
import {
  AppTypeRegistry,
  Camera3d,
  Children,
  Commands,
  Cuboid,
  GlobalTransform,
  MaterialPlugin,
  Mesh,
  Mesh3d,
  Meshes,
  Name,
  Parent,
  Query,
  ResMut,
  serializeWorld,
  spawnScene,
  Time,
  Transform,
  UnlitMaterial,
  UnlitMaterialPlugin,
  Visibility,
} from '@retro-engine/engine';

/**
 * Playground showcase that round-trips a real renderable graph through JSON and
 * spawns it back into the live world. No lights needed — the child is unlit.
 */
export const serializeShowcasePlugin: Plugin = (app) => {
  const log = app.logger.child('serialize-showcase');
  const unlit = new MaterialPlugin(UnlitMaterial);
  app.addPlugin(new UnlitMaterialPlugin());
  app.addPlugin(unlit);

  // Spin the round-tripped root about Y so its child orbits it. Because the
  // child is parented only through the serialized Parent edge, an orbit at all
  // proves the hierarchy + GlobalTransform were rebuilt from the JSON.
  app.addSystem('update', [Query([Transform, Name]), ResMut(Time)], (roots, time) => {
    for (const [entity, transform, name] of roots.entries()) {
      if (name.value !== 'serialized-root') continue;
      quat.fromAxisAngle(vec3.create(0, 1, 0), time.virtual.elapsed * 0.8, transform.rotation);
      app.world.markChanged(entity, Transform);
    }
  });

  app.addSystem(
    'startup',
    [Commands, ResMut(Meshes), ResMut(unlit.Materials)],
    (cmd, meshes, materials) => {
      // Real assets in the live stores — what the respawned mesh renders.
      const cuboid = meshes.add(new Cuboid().mesh().build());
      const material = materials.add(new UnlitMaterial({ color: vec4.create(0.3, 0.8, 1, 1) }));

      // The persistent identities the handles serialize by.
      const meshGuid = generateAssetGuid();
      const matGuid = generateAssetGuid();

      // 1. Author the SOURCE graph in a throwaway world: a named root with one
      //    renderable child offset on +X, linked by a Parent edge.
      const source = new World();
      const root = source.spawn(new Transform(), new Name('serialized-root'));
      source.spawn(
        new Transform(vec3.create(2, 0, 0)),
        new Mesh3d(makeHandle<Mesh>(cuboid.index, meshGuid)),
        new unlit.MeshMaterial3d(makeHandle<UnlitMaterial>(material.index, matGuid)),
        new Visibility('Visible'),
        new Parent(root),
      );

      // 2. Serialize to JSON (handles persist by GUID) and dump it.
      const registry = app.getResource(AppTypeRegistry)!.registry;
      const json: SceneData = serializeWorld(source, registry, { handleRef: (_t, h) => h.guid });
      log.info('serialized scene — JSON below, world next:');
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(json, null, 2));

      // 3. Round-trip the JSON text, then spawn it into the LIVE world through
      //    Commands so hooks fire, requires resolve, and Children rebuilds. The
      //    resolver maps each GUID back to its live store handle.
      const scene: SceneData = JSON.parse(JSON.stringify(json)) as SceneData;
      const idMap = spawnScene(app, scene, undefined, {
        resolveHandle: (_assetType, g) =>
          g === meshGuid ? cuboid : g === matGuid ? material : makeHandle(asAssetIndex(0)),
      });
      log.info(`spawned ${idMap.size} entities from JSON into the live world`);

      // Camera framing the orbiting child.
      const camT = new Transform();
      camT.translation = vec3.create(0, 2.5, 8);
      quat.fromAxisAngle(vec3.create(1, 0, 0), -0.28, camT.rotation);
      cmd.spawn(...Camera3d({ transform: camT }));
    },
  );

  // One-shot post-load confirmation: after the first frame's propagation, read
  // the live world back and print what the JSON round-trip actually produced.
  let confirmed = false;
  app.addSystem('last', [Query([Mesh3d, Parent, GlobalTransform])], (children) => {
    if (confirmed) return;
    for (const [child, , parent, gt] of children.entries()) {
      const parentEntity = parent.entity;
      const parentChildren = app.world.getComponent(parentEntity, Children);
      const parentName = app.world.getComponent(parentEntity, Name);
      const mesh = app.world.getComponent(child, Mesh3d);
      log.info('JSON → world confirmed (read back from the live world):');
      // eslint-disable-next-line no-console
      console.log({
        child,
        parent: parentEntity,
        parentName: parentName?.value,
        childrenRebuiltFromParentEdge: parentChildren?.entities.includes(child) ?? false,
        meshHandleResolvedByGuid: mesh?.handle.guid !== undefined,
        globalTransformRecomputed: Array.from(gt.matrix.slice(12, 15)),
      });
      confirmed = true;
    }
  });
};
