// Device check for scene composition (ADR-0071): a parent scene includes a child
// scene as nested entities, the SAME child instanced twice, each named and
// positioned by its own mount entity — the live-link (Godot instanced-scene)
// model.
//
// On startup a one-cube child scene ("Pillar") and a parent scene ("Level") are
// authored and registered as Scene assets. The Level has two mount entities,
// "Bay_Left" (x=-2) and "Bay_Right" (x=+2), each carrying a `scene` ref to the
// Pillar GUID. A SceneRoot spawns the Level; the reactor instantiates it, then
// the two nested Pillars under their bays a frame later — so two independent
// pillars appear, offset by their mounts. The Level root spins so the whole
// composed graph orbits, proving the nested hierarchy is live.
//
// A summary of the live graph is published to `window.__compose` each frame for
// automated validation: pillar count, mount names, and each pillar's inherited
// world-X. Open ?mode=compose in a WebGPU browser (restart the dev server first).

import { quat, vec3, vec4 } from '@retro-engine/math';
import { World } from '@retro-engine/ecs';
import { generateAssetGuid, makeHandle } from '@retro-engine/assets';
import type { Handle } from '@retro-engine/assets';
import type { Mesh, Plugin, SceneData, SerializedEntity } from '@retro-engine/engine';
import {
  AppTypeRegistry,
  AssetPlugin,
  Camera3d,
  Commands,
  Cuboid,
  GlobalTransform,
  MaterialPlugin,
  Meshes,
  Mesh3d,
  Name,
  Parent,
  Query,
  ResMut,
  Scene,
  Scenes,
  ScenePlugin,
  SceneRoot,
  Time,
  Transform,
  UnlitMaterial,
  UnlitMaterialPlugin,
  Visibility,
  serializeWorld,
} from '@retro-engine/engine';

const nameOf = (entity: SerializedEntity): string | undefined => {
  for (const c of entity.components) {
    if (c.type === 'Name') return (c.data as { value: string }).value;
  }
  return undefined;
};

/**
 * Playground showcase that composes scenes: a parent "Level" scene includes the
 * same child "Pillar" scene twice as named, positioned nested instances.
 */
export const compositionShowcasePlugin: Plugin = (app) => {
  const log = app.logger.child('composition-showcase');
  const unlit = new MaterialPlugin(UnlitMaterial);
  app.addPlugin(new AssetPlugin());
  app.addPlugin(new UnlitMaterialPlugin());
  app.addPlugin(unlit);
  app.addPlugin(new ScenePlugin());

  app.addSystem(
    'startup',
    [Commands, ResMut(Meshes), ResMut(unlit.Materials), ResMut(Scenes)],
    (cmd, meshes, materials, scenes) => {
      const registry = app.getResource(AppTypeRegistry)!.registry;

      // Real assets the nested pillars render.
      const cuboid = meshes.add(new Cuboid().mesh().build());
      const material = materials.add(new UnlitMaterial({ color: vec4.create(0.4, 0.85, 1, 1) }));
      const meshGuid = generateAssetGuid();
      const matGuid = generateAssetGuid();

      // Child scene "Pillar": one cube entity.
      const childWorld = new World();
      childWorld.spawn(
        new Transform(),
        new Mesh3d(makeHandle<Mesh>(cuboid.index, meshGuid)),
        new unlit.MeshMaterial3d(makeHandle<UnlitMaterial>(material.index, matGuid)),
        new Visibility('Visible'),
        new Name('Pillar'),
      );
      const pillarGuid = generateAssetGuid();
      scenes.add(new Scene(serializeWorld(childWorld, registry, { handleRef: (_t, h) => h.guid })), pillarGuid);

      // Parent scene "Level": a spinning root with two bays, each nesting Pillar.
      const levelWorld = new World();
      const level = levelWorld.spawn(new Transform(), new Name('Level'));
      levelWorld.spawn(new Transform(vec3.create(-2, 0, 0)), new Name('Bay_Left'), new Parent(level));
      levelWorld.spawn(new Transform(vec3.create(2, 0, 0)), new Name('Bay_Right'), new Parent(level));
      const authored = serializeWorld(levelWorld, registry);
      const levelData: SceneData = {
        ...authored,
        entities: authored.entities.map((e: SerializedEntity) =>
          nameOf(e) === 'Bay_Left' || nameOf(e) === 'Bay_Right' ? { ...e, scene: { guid: pillarGuid } } : e,
        ),
      };
      const levelHandle = scenes.add(new Scene(levelData));

      // One resolver serves both nested scene refs and asset handles.
      const resolveHandle = (assetType: string, guid: string): Handle<unknown> => {
        if (assetType === 'Scene') return scenes.handleByGuid(guid as never)!;
        if (guid === meshGuid) return cuboid;
        if (guid === matGuid) return material;
        return makeHandle(0 as never);
      };

      cmd.spawn(new SceneRoot(levelHandle, resolveHandle), new Transform());

      // Camera outside the composed graph.
      const camT = new Transform();
      camT.translation = vec3.create(0, 2, 9);
      quat.fromAxisAngle(vec3.create(1, 0, 0), -0.2, camT.rotation);
      cmd.spawn(...Camera3d({ transform: camT }));
      log.info('composed Level with two nested Pillar instances');
    },
  );

  // Spin the Level root so the whole nested graph orbits — live-link proof.
  app.addSystem('update', [Query([Transform, Name]), ResMut(Time)], (roots, time) => {
    for (const [entity, transform, name] of roots.entries()) {
      if (name.value !== 'Level') continue;
      quat.fromAxisAngle(vec3.create(0, 1, 0), time.virtual.elapsed * 0.6, transform.rotation);
      app.world.markChanged(entity, Transform);
    }
  });

  // Publish a verifiable summary of the live composed graph for automation.
  app.addSystem('update', [Query([Name, GlobalTransform])], (q) => {
    const bays: string[] = [];
    const pillarWorldX: number[] = [];
    for (const [, name, gt] of q.entries()) {
      if (name.value.startsWith('Bay_')) bays.push(name.value);
      if (name.value === 'Pillar') pillarWorldX.push(Math.round(gt.matrix[12]!));
    }
    if (typeof window !== 'undefined') {
      (window as unknown as { __compose: unknown }).__compose = {
        pillars: pillarWorldX.length,
        bays: bays.sort(),
        pillarWorldX: pillarWorldX.sort((a, b) => a - b),
      };
    }
  });
};
