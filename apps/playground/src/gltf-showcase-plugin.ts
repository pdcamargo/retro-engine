// Device check for the real glTF load path: GltfPlugin registers the .gltf /
// .glb AssetServer importer, AssetServer.load kicks the async decode, and a
// GltfSceneRoot entity makes the instantiation reactor mirror the model's node
// graph as a named entity tree (Mesh3d + MeshMaterial3d per primitive, correct
// PBR + sRGB base colour, double-sided MASK foliage).
//
// The bun dev server serves only the bundle graph (no static /models folder),
// so a small AssetSource maps the names the .gltf references internally onto the
// bundled (hashed) URLs. GPU output is not headless-verifiable; open ?mode=gltf
// in a WebGPU browser (restart the dev server first — it does not hot-reload
// workspace packages).

import { quat, vec3 } from '@retro-engine/math';
import type { AssetSource, Plugin } from '@retro-engine/engine';
import {
  AmbientLight,
  AssetPlugin,
  AssetServer,
  Camera3d,
  Commands,
  DirectionalLight3d,
  Light3dPlugin,
  MaterialPlugin,
  StandardMaterial,
  StandardMaterialPlugin,
  Transform,
} from '@retro-engine/engine';
import { GltfPlugin, GltfSceneRoot } from '@retro-engine/gltf';
import type { Gltf } from '@retro-engine/gltf';

import gltfUrl from '../models/Clover_1.gltf';
import binUrl from '../models/Clover_1.bin';
import textureUrl from '../models/Leaves.png';

const MODEL = 'Clover_1.gltf';

// The model's siblings come in as bundled URLs keyed by the names the .gltf
// references internally.
const FILE_URLS: Readonly<Record<string, string>> = {
  'Clover_1.gltf': gltfUrl,
  'Clover_1.bin': binUrl,
  'Leaves.png': textureUrl,
};

const bundledModelSource: AssetSource = {
  read: async (location) => {
    const name = location.split('/').pop() ?? location;
    const url = FILE_URLS[name];
    if (url === undefined) throw new Error(`gltf-showcase: no bundled URL for '${name}'`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`gltf-showcase: fetch ${name} -> ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  },
};

export const gltfShowcasePlugin: Plugin = (app) => {
  const log = app.logger.child('gltf-showcase');
  app.addPlugin(new AssetPlugin({ source: bundledModelSource }));
  app.addPlugin(new StandardMaterialPlugin());
  const pbr = new MaterialPlugin(StandardMaterial);
  app.addPlugin(pbr);
  app.insertResource(new AmbientLight({ color: vec3.create(1, 1, 1), brightness: 0.45 }));
  app.addPlugin(new Light3dPlugin());
  app.addPlugin(new GltfPlugin({ material: pbr }));

  const handle = app.getResource(AssetServer)!.load<Gltf>(MODEL);

  app.addSystem('startup', [Commands], (cmd) => {
    const sunT = new Transform();
    quat.fromAxisAngle(vec3.create(1, 0, 0), -0.6, sunT.rotation);
    cmd.spawn(new DirectionalLight3d({ color: vec3.create(1, 0.97, 0.9), intensity: 3 }), sunT);

    // GltfSceneRoot instantiates the node graph under this entity; the transform
    // frames Clover_1 (~1.1 units tall, centred near the origin) at y≈1.
    const modelT = new Transform();
    modelT.scale = vec3.create(1.8, 1.8, 1.8);
    modelT.translation = vec3.create(0.19, -0.01, 0.03);
    cmd.spawn(new GltfSceneRoot(handle), modelT);

    const camT = new Transform();
    camT.translation = vec3.create(0, 1.3, 4.5);
    quat.fromAxisAngle(vec3.create(1, 0, 0), -Math.atan2(0.3, 4.5), camT.rotation);
    cmd.spawn(...Camera3d({ transform: camT }));

    log.info(`loading ${MODEL} via AssetServer; GltfSceneRoot will instantiate the node graph`);
  });
};
