// Visual check for the glTF → engine asset mapping (Mesh / StandardMaterial /
// Image). This is a throwaway manual harness: it fetches a real model, parses +
// decodes it, calls mapGltfAssets directly with the browser createImageBitmap
// decoder, and spawns one entity per primitive. The proper file-load path
// (GltfPlugin importer + GltfSceneRoot instantiation) replaces all of this in
// the next slice; until then this proves the mapping renders real models with
// decoded textures + PBR (double-sided MASK foliage, sRGB base color).
//
// GPU output is not headless-verifiable; open ?mode=gltf in a WebGPU browser
// (restart the dev server first — it does not hot-reload workspace packages).

import { Aabb, quat, vec3 } from '@retro-engine/math';
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
  StandardMaterial,
  StandardMaterialPlugin,
  Transform,
} from '@retro-engine/engine';
import {
  createImageBitmapDecoder,
  mapGltfAssets,
  parseGltf,
  resolveBuffers,
} from '@retro-engine/gltf';
import type { MappedGltfAssets, SiblingReader } from '@retro-engine/gltf';

import gltfUrl from '../models/Clover_1.gltf';
import binUrl from '../models/Clover_1.bin';
import textureUrl from '../models/Leaves.png';

const MODEL = 'Clover_1.gltf';

// The dev server (bun index.html) serves only the bundle graph, not a static
// folder — so the model's siblings come in as bundled URLs keyed by the names
// the .gltf references internally.
const FILE_URLS: Readonly<Record<string, string>> = {
  'Clover_1.gltf': gltfUrl,
  'Clover_1.bin': binUrl,
  'Leaves.png': textureUrl,
};

export const gltfShowcasePlugin: Plugin = (app) => {
  const log = app.logger.child('gltf-showcase');
  const pbr = new MaterialPlugin(StandardMaterial);
  app.addPlugin(new StandardMaterialPlugin());
  app.addPlugin(pbr);
  app.insertResource(new AmbientLight({ color: vec3.create(1, 1, 1), brightness: 0.45 }));
  app.addPlugin(new Light3dPlugin());

  const meshes = app.getResource(Meshes);
  const images = app.getResource(Images);
  const materials = app.getResource(pbr.Materials);
  if (meshes === undefined || images === undefined || materials === undefined) {
    throw new Error('gltf-showcase: asset stores missing (material plugins not built?)');
  }

  let mapped: MappedGltfAssets | undefined;
  let spawned = false;

  // Manual load context: fetch siblings, and register sub-assets by inserting
  // straight into the stores (the proper AssetServer load-drain is item 6's job
  // — this harness just wants the handles).
  const read: SiblingReader = async (relativePath) => {
    const url = FILE_URLS[relativePath];
    if (url === undefined) throw new Error(`gltf-showcase: no bundled URL for '${relativePath}'`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`gltf-showcase: fetch ${relativePath} -> ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  };
  const ctx: LoadContext = {
    path: MODEL,
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

  const sunT = new Transform();
  quat.fromAxisAngle(vec3.create(1, 0, 0), -0.6, sunT.rotation);
  app.addSystem('startup', [Commands], (cmd) => {
    cmd.spawn(new DirectionalLight3d({ color: vec3.create(1, 0.97, 0.9), intensity: 3 }), sunT);
  });

  // Spawn the model once the async load resolves, normalized to ~2 units at the
  // origin so its authored scale/offset can't push it out of frame.
  app.addSystem('update', [Commands], (cmd) => {
    if (spawned || mapped === undefined) return;
    spawned = true;

    const scratch = new Aabb();
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    let primitiveCount = 0;
    for (const mesh of mapped.meshes) {
      for (const primitive of mesh.primitives) {
        const asset = meshes.get(primitive.mesh);
        if (asset === undefined) continue;
        primitiveCount += 1;
        asset.computeAabb(scratch);
        const c = scratch.center;
        const h = scratch.halfExtents;
        minX = Math.min(minX, c[0]! - h[0]!);
        minY = Math.min(minY, c[1]! - h[1]!);
        minZ = Math.min(minZ, c[2]! - h[2]!);
        maxX = Math.max(maxX, c[0]! + h[0]!);
        maxY = Math.max(maxY, c[1]! + h[1]!);
        maxZ = Math.max(maxZ, c[2]! + h[2]!);
      }
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const cz = (minZ + maxZ) / 2;
    const scale = 2 / Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1e-3);

    for (const mesh of mapped.meshes) {
      for (const primitive of mesh.primitives) {
        if (primitive.material === undefined) continue;
        const t = new Transform();
        t.scale = vec3.create(scale, scale, scale);
        t.translation = vec3.create(-cx * scale, 1 - cy * scale, -cz * scale);
        cmd.spawn(new Mesh3d(primitive.mesh), new pbr.MeshMaterial3d(primitive.material), t);
      }
    }

    const camT = new Transform();
    camT.translation = vec3.create(0, 1.3, 4.5);
    quat.fromAxisAngle(vec3.create(1, 0, 0), -Math.atan2(0.3, 4.5), camT.rotation);
    cmd.spawn(...Camera3d({ transform: camT }));

    log.info(`spawned ${primitiveCount} primitive(s)`);
  });
};
