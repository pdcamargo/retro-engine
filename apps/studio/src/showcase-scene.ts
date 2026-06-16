// The studio's prototype "showcase" scene: one of each content-production
// mechanism the engine supports, so the editor's hierarchy + inspector are
// proven against all of them, not just trivial entities. Plain entities, a
// prefab-template instance, and a nested-scene instance are authored into a
// SceneData and loaded via spawnScene; a glTF model is spawned programmatically
// (GltfSceneRoot carries an asset handle and has no reflection schema, so it
// cannot live in a serialized scene). Mirrors the playground composition /
// prefab / gltf showcase plugins.

import { quat, vec3, vec4 } from '@retro-engine/math';
import { t } from '@retro-engine/reflect';
import { World } from '@retro-engine/ecs';
import { type AssetGuid, type Handle, makeHandle } from '@retro-engine/assets';
import type { App, AssetSource, Mesh, SceneData, SerializedComponent } from '@retro-engine/engine';
import {
  AppTypeRegistry,
  AssetPlugin,
  AssetServer,
  Commands,
  Cuboid,
  defineTemplate,
  MaterialPlugin,
  Mesh3d,
  Meshes,
  Name,
  ResMut,
  SCENE_FORMAT_VERSION,
  Scene,
  ScenePlugin,
  Scenes,
  serializeWorld,
  spawnScene,
  StandardMaterial,
  Transform,
  Visibility,
} from '@retro-engine/engine';
import { type Gltf, GltfPlugin, GltfSceneRoot } from '@retro-engine/gltf';

import binUrl from '../models/Clover_1.bin';
import gltfUrl from '../models/Clover_1.gltf';
import textureUrl from '../models/Leaves.png';

const TEMPLATE_NAME = 'ShowcaseCube';
const CHILD_SCENE_GUID = 'studio-showcase-pillar';
const MESH_GUID = 'studio-showcase-mesh';
const MAT_GUID = 'studio-showcase-mat';

const transform = (translation: readonly [number, number, number]): SerializedComponent => ({
  type: 'Transform',
  version: 1,
  data: { translation: [...translation], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
});
const named = (value: string): SerializedComponent => ({ type: 'Name', version: 1, data: { value } });
const parentOf = (id: number): SerializedComponent => ({ type: 'Parent', version: 1, data: { entity: id } });

// The sun's orientation: aimed down toward the ground (forward = −Z).
const SUN_ROTATION = [...quat.fromEuler(-Math.PI / 3, Math.PI / 5, 0, 'xyz', quat.create())];

/**
 * The authored parent scene: a root with three children — a plain marker, a
 * prefab-template instance, and a nested-scene mount. Registry-independent plain
 * data, so it is the thing a {@link SceneSource} hands back.
 */
export const SHOWCASE_SCENE: SceneData = {
  version: SCENE_FORMAT_VERSION,
  entities: [
    { id: 0, components: [transform([0, 0, 0]), named('Showcase')] },
    { id: 1, components: [transform([2.5, 0.5, 0]), named('Marker'), parentOf(0)] },
    {
      id: 2,
      components: [named('Templated Cube'), parentOf(0)],
      templates: [
        {
          template: TEMPLATE_NAME,
          params: { position: [-2.5, 0.5, 0] },
          overrides: [{ type: 'Transform', data: { scale: [0.7, 0.7, 0.7] } }],
        },
      ],
    },
    { id: 3, components: [transform([0, 0.5, -2.5]), named('Nested Prop'), parentOf(0)], scene: { guid: CHILD_SCENE_GUID } },
    {
      id: 4,
      components: [
        { type: 'Transform', version: 1, data: { translation: [0, 0, 0], rotation: SUN_ROTATION, scale: [1, 1, 1] } },
        { type: 'DirectionalLight3d', version: 1, data: { color: [1, 1, 1], intensity: 3.2 } },
        named('Sun'),
        parentOf(0),
      ],
    },
  ],
};

const MODEL = 'Clover_1.gltf';
const FILE_URLS: Readonly<Record<string, string>> = {
  'Clover_1.gltf': gltfUrl,
  'Clover_1.bin': binUrl,
  'Leaves.png': textureUrl,
};
const bundledModelSource: AssetSource = {
  read: async (location): Promise<Uint8Array> => {
    const fileName = location.split('/').pop() ?? location;
    const url = FILE_URLS[fileName];
    if (url === undefined) throw new Error(`studio showcase: no bundled URL for '${fileName}'`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`studio showcase: fetch ${fileName} -> ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  },
};

/** Dependencies the showcase shares with the rest of the studio bootstrap. */
export interface ShowcaseDeps {
  /** The StandardMaterial plugin instance the viewport scene already set up. */
  readonly material: MaterialPlugin<StandardMaterial>;
  /** The parent scene to load (resolved from a {@link SceneSource}). */
  readonly scene: SceneData;
}

/**
 * Register the asset/scene/glTF plugins and a startup system that brings the
 * showcase into the live world: a prefab template, a nested child scene, the
 * authored parent scene, and a programmatic glTF instance.
 */
export const installShowcaseScene = (app: App, deps: ShowcaseDeps): void => {
  app.addPlugin(new AssetPlugin({ source: bundledModelSource }));
  app.addPlugin(new ScenePlugin());
  app.addPlugin(new GltfPlugin({ material: deps.material }));

  const gltfHandle = app.getResource(AssetServer)!.load<Gltf>(MODEL);

  app.addSystem(
    'startup',
    [Commands, ResMut(Meshes), ResMut(deps.material.Materials), ResMut(Scenes)],
    (cmd, meshes, materials, scenes) => {
      const registry = app.getResource(AppTypeRegistry)!.registry;

      const cubeMesh = meshes.add(new Cuboid().mesh().build());
      const greenMat = materials.add(new StandardMaterial({ baseColor: vec4.create(0.35, 0.8, 0.45, 1), roughness: 0.6 }));
      const tealMat = materials.add(new StandardMaterial({ baseColor: vec4.create(0.3, 0.7, 0.85, 1), roughness: 0.5 }));

      // Prefab template: a renderable cube positioned by a param. Handles are
      // captured live, so the scene that embeds it never serializes them.
      app.registerTemplate(
        defineTemplate({
          name: TEMPLATE_NAME,
          params: { position: t.vec3.default(() => vec3.create(0, 0, 0)) },
          build: ({ position }) => [
            new Transform(position),
            new Mesh3d(cubeMesh),
            new deps.material.MeshMaterial3d(greenMat),
            new Visibility('Visible'),
          ],
        }),
      );

      // Child scene ("Pillar"): one named, renderable cube, authored in a
      // throwaway world and serialized so the live link round-trips like any
      // saved scene.
      const childWorld = new World();
      childWorld.spawn(
        new Transform(),
        new Mesh3d(makeHandle<Mesh>(cubeMesh.index, MESH_GUID as AssetGuid)),
        new deps.material.MeshMaterial3d(makeHandle<StandardMaterial>(tealMat.index, MAT_GUID as AssetGuid)),
        new Visibility('Visible'),
        new Name('Pillar'),
      );
      scenes.add(
        new Scene(serializeWorld(childWorld, registry, { handleRef: (_type, h) => h.guid })),
        CHILD_SCENE_GUID as AssetGuid,
      );

      // One resolver serves the nested-scene ref and the cube's asset handles —
      // it is threaded into the SceneRoot, so the child instantiation reuses it.
      const resolveHandle = (assetType: string, guid: string): Handle<unknown> => {
        if (assetType === 'Scene') return scenes.handleByGuid(guid as AssetGuid)!;
        if (guid === MESH_GUID) return cubeMesh;
        if (guid === MAT_GUID) return tealMat;
        return makeHandle(0 as never);
      };

      const idMap = spawnScene(app, deps.scene, undefined, { resolveHandle });

      // glTF model — instantiated programmatically (GltfSceneRoot has no schema,
      // so it can't live in the serialized scene). Named + parented under the
      // showcase root so it reads as authored content in the hierarchy.
      const modelT = new Transform();
      modelT.translation = vec3.create(0, 0, 2.5);
      modelT.scale = vec3.create(1.4, 1.4, 1.4);
      const model = cmd.spawn(new GltfSceneRoot(gltfHandle), modelT, new Name('Clover Model'));
      const showcaseRoot = idMap.get(0);
      if (showcaseRoot !== undefined) cmd.entity(showcaseRoot).addChild(model.id);
    },
    { label: 'studio-showcase' },
  );
};
