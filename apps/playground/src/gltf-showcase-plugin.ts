// Visual check for the glTF → engine asset mapping (Mesh / StandardMaterial /
// Image). This is a throwaway manual harness: it fetches a real model, parses +
// decodes it, calls mapGltfAssets directly with the browser createImageBitmap
// decoder, and spawns one entity per primitive. The proper file-load path
// (GltfPlugin importer + GltfSceneRoot instantiation) replaces all of this in
// the next slice; until then this proves the mapping renders real models with
// decoded textures + PBR (double-sided MASK foliage, sRGB base color).
//
// GPU output is not headless-verifiable; open ?mode=gltf in a WebGPU browser
// (restart the dev server first — it does not hot-reload engine changes).

import { quat, vec3 } from '@retro-engine/math';
import type { LoadContext, Plugin } from '@retro-engine/engine';
import {
  AmbientLight,
  Camera3d,
  Commands,
  DirectionalLight3d,
  Images,
  Light3dPlugin,
  MaterialPlugin,
  Mesh3d,
  Meshes,
  Query,
  ResMut,
  StandardMaterial,
  StandardMaterialPlugin,
  Time,
  Transform,
} from '@retro-engine/engine';
import {
  createImageBitmapDecoder,
  mapGltfAssets,
  parseGltf,
  resolveBuffers,
} from '@retro-engine/gltf';
import type { MappedGltfAssets, SiblingReader } from '@retro-engine/gltf';

const MODEL = 'Clover_1.gltf';

/** Marks a spawned primitive to rotate so its double-sided faces are visible. */
class Spin {
  constructor(public readonly speed: number) {}
}

export const gltfShowcasePlugin: Plugin = (app) => {
  const log = app.logger.child('gltf-showcase');
  const pbr = new MaterialPlugin(StandardMaterial);
  app.addPlugin(new StandardMaterialPlugin());
  app.addPlugin(pbr);
  app.insertResource(new AmbientLight({ color: vec3.create(1, 1, 1), brightness: 0.35 }));
  app.addPlugin(new Light3dPlugin());

  const meshes = app.getResource(Meshes);
  const images = app.getResource(Images);
  const materials = app.getResource(pbr.Materials);
  if (meshes === undefined || images === undefined || materials === undefined) {
    throw new Error('gltf-showcase: asset stores missing (material plugins not built?)');
  }

  let mapped: MappedGltfAssets | undefined;
  let spawned = false;

  // Manual load context: fetch siblings from /models, and register sub-assets by
  // inserting straight into the stores (the proper AssetServer load-drain is
  // item 6's job — this harness just wants the handles).
  const read: SiblingReader = async (relativePath) =>
    new Uint8Array(await (await fetch(`/models/${relativePath}`)).arrayBuffer());
  const ctx: LoadContext = {
    path: `/models/${MODEL}`,
    read,
    addLabeledAsset: (_label, value, store) => store.add(value),
  };

  void (async () => {
    try {
      const { document, bin } = parseGltf(await read(MODEL));
      const buffers = await resolveBuffers(document, bin, read);
      mapped = await mapGltfAssets(
        document,
        buffers,
        ctx,
        { meshes, materials, images },
        createImageBitmapDecoder,
      );
      log.info(
        `mapped ${mapped.meshes.length} mesh(es), ${mapped.materials.length} material(s), ` +
          `${mapped.images.length} image(s)`,
      );
    } catch (err) {
      log.error(`failed to load ${MODEL}: ${String(err)}`);
    }
  })();

  app.addSystem('startup', [Commands], (cmd) => {
    const camT = new Transform();
    camT.translation = vec3.create(0, 1, 3);
    quat.fromAxisAngle(vec3.create(1, 0, 0), -0.2, camT.rotation);
    cmd.spawn(...Camera3d({ transform: camT }));

    const sunT = new Transform();
    quat.fromAxisAngle(vec3.create(1, 0, 0), -0.6, sunT.rotation);
    cmd.spawn(new DirectionalLight3d({ color: vec3.create(1, 0.97, 0.9), intensity: 3 }), sunT);
  });

  // Spawn the mapped primitives once the async load resolves.
  app.addSystem('update', [Commands], (cmd) => {
    if (spawned || mapped === undefined) return;
    spawned = true;
    for (const mesh of mapped.meshes) {
      for (const primitive of mesh.primitives) {
        if (primitive.material === undefined) continue;
        cmd.spawn(
          new Mesh3d(primitive.mesh),
          new pbr.MeshMaterial3d(primitive.material),
          new Transform(),
          new Spin(0.5),
        );
      }
    }
    log.info('spawned glTF primitives');
  });

  app.addSystem('update', [Query([Transform, Spin]), ResMut(Time)], (spinners, time) => {
    const t = time.virtual.elapsed;
    for (const [entity, transform, spin] of spinners.entries()) {
      quat.fromAxisAngle(vec3.create(0, 1, 0), t * spin.speed, transform.rotation);
      app.world.markChanged(entity, Transform);
    }
  });
};
