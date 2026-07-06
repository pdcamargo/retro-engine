import { describe, expect, it } from 'bun:test';

import { asAssetIndex, generateAssetGuid, makeHandle } from '@retro-engine/assets';
import type { AssetManifest } from '@retro-engine/assets';
import { vec4 } from '@retro-engine/math';
import type { FieldType } from '@retro-engine/reflect';

import {
  App,
  AssetPlugin,
  AssetServer,
  applyCompletedLoads,
  Camera3d,
  createMaterialSerializer,
  createMeshImporter,
  createMeshSerializer,
  DirectionalLight3d,
  type Image,
  Light3dPlugin,
  MaterialPlugin,
  materialReflectionSchema,
  Mesh,
  MeshAttribute,
  Meshes,
  registerMaterialLoaders,
  SCENE_FORMAT_VERSION,
  type SceneData,
  StandardMaterial,
  StandardMaterialPlugin,
  Transform,
  u16Indices,
} from '../index';
import { vec3 } from '@retro-engine/math';
import { MemoryAssetSource } from '../asset/memory-sink';
import { spawnScene } from '../scene/spawn';
import { makeCapturingRenderer, makeStubCanvas } from '../test-utils';

const buildCube = (): Mesh =>
  new Mesh({ label: 'cube' })
    .insertAttribute(MeshAttribute.POSITION, new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]))
    .insertAttribute(MeshAttribute.NORMAL, new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]))
    // UV_0 is required by the PBR vertex shader — without it the renderer now
    // skips the draw (see the missing-attribute guard), so the fixture provides it.
    .insertAttribute(MeshAttribute.UV_0, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]))
    .setIndices(u16Indices([0, 1, 2, 1, 3, 2]));

const buildApp = (source?: MemoryAssetSource) => {
  const { renderer } = makeCapturingRenderer();
  const app = new App({ renderer, canvas: makeStubCanvas() });
  app.addPlugin(new StandardMaterialPlugin());
  const pbr = new MaterialPlugin(StandardMaterial);
  app.addPlugin(pbr);
  app.addPlugin(new Light3dPlugin());
  if (source !== undefined) app.addPlugin(new AssetPlugin({ source }));
  return { app, pbr };
};

describe('materialReflectionSchema', () => {
  it('derives serializable fields from the bind group + knob extras', () => {
    const schema = materialReflectionSchema(StandardMaterial) as unknown as Record<
      string,
      FieldType<unknown>
    >;
    // Uniform vec4 with the color semantic → vec4 + color widget hint.
    expect(schema.baseColor!.kind).toBe('vec4');
    expect(schema.baseColor!.hints?.widget).toBe('color');
    // Scalar with a range hint.
    expect(schema.metallic!.kind).toBe('number');
    expect(schema.metallic!.hints?.range).toEqual([0, 1]);
    // Handle texture → optional Image handle.
    expect(schema.baseColorTexture!.kind).toBe('handle');
    expect(schema.baseColorTexture!.assetType).toBe('Image');
    expect(schema.baseColorTexture!.isOptional).toBe(true);
    // serializedExtras knobs.
    expect(schema.depthBias_!.kind).toBe('number');
    expect(schema.doubleSided_!.kind).toBe('boolean');
    // Sampler entries share a texture field — no separate field derived.
    expect(Object.keys(schema)).not.toContain('baseColorSampler');
  });
});

describe('material .remat round-trip', () => {
  it('round-trips scalar / color / knob fields through serialize → deserialize', () => {
    const { app } = buildApp(new MemoryAssetSource(new Map()));
    const serializer = createMaterialSerializer<StandardMaterial>(app, StandardMaterial);
    const material = new StandardMaterial({
      baseColor: vec4.create(0.2, 0.4, 0.6, 1),
      metallic: 1,
      roughness: 0.25,
      doubleSided: true,
      depthBias: -2,
    });
    const restored = serializer.deserialize(serializer.serialize(material));
    expect(Array.from(restored.baseColor)).toEqual(Array.from(material.baseColor));
    expect(restored.metallic).toBeCloseTo(1, 5);
    expect(restored.roughness).toBeCloseTo(0.25, 5);
    expect(restored.doubleSided_).toBe(true);
    expect(restored.depthBias_).toBe(-2);
  });

  it('encodes a texture handle by GUID', () => {
    const { app } = buildApp(new MemoryAssetSource(new Map()));
    const serializer = createMaterialSerializer<StandardMaterial>(app, StandardMaterial);
    const guid = generateAssetGuid();
    const material = new StandardMaterial({ baseColorTexture: makeHandle<Image>(asAssetIndex(5), guid) });
    const file = JSON.parse(new TextDecoder().decode(serializer.serialize(material))) as {
      material: { data: Record<string, unknown> };
    };
    expect(file.material.data.baseColorTexture).toBe(guid);
  });
});

describe('kind-routed material loading', () => {
  it('loads a .remat by GUID into its per-type store', async () => {
    const writer = buildApp(new MemoryAssetSource(new Map()));
    const bytes = createMaterialSerializer<StandardMaterial>(writer.app, StandardMaterial).serialize(
      new StandardMaterial({ baseColor: vec4.create(0.9, 0.1, 0.1, 1), metallic: 1, roughness: 0.2 }),
    );

    const guid = generateAssetGuid();
    const source = new MemoryAssetSource(new Map([['mat.remat', bytes]]));
    const { app, pbr } = buildApp(source);
    const server = app.getResource(AssetServer)!;
    const manifest: AssetManifest = {
      entries: new Map([[guid, { guid, location: 'mat.remat', kind: 'StandardMaterial' }]]),
    };
    server.setManifest(manifest);
    registerMaterialLoaders(app);

    const handle = server.loadByGuid<StandardMaterial>(guid);
    await server.settle();
    applyCompletedLoads(server);

    const store = app.getResource(pbr.Materials)!;
    const loaded = store.get(handle);
    expect(loaded).toBeInstanceOf(StandardMaterial);
    expect(loaded!.metallic).toBeCloseTo(1, 5);
    expect(Array.from(loaded!.baseColor)[0]).toBeCloseTo(0.9, 5);
  });

  it('resolves a scene-referenced material on demand (the mesh→material path)', async () => {
    const bytes = createMaterialSerializer<StandardMaterial>(
      buildApp(new MemoryAssetSource(new Map())).app,
      StandardMaterial,
    ).serialize(new StandardMaterial({ metallic: 1, roughness: 0.3 }));

    const matGuid = generateAssetGuid();
    const { app, pbr } = buildApp(new MemoryAssetSource(new Map([['mat.remat', bytes]])));
    const server = app.getResource(AssetServer)!;
    server.setManifest({
      entries: new Map([[matGuid, { guid: matGuid, location: 'mat.remat', kind: 'StandardMaterial' }]]),
    });
    registerMaterialLoaders(app);

    // A scene entity carrying just a material reference, like an authored mesh's
    // MeshMaterial3d — resolved by the default on-demand resolver, no throw.
    const scene: SceneData = {
      version: SCENE_FORMAT_VERSION,
      entities: [
        {
          id: 0,
          components: [
            { type: 'MeshMaterial3d<StandardMaterial>', version: 1, data: { handle: matGuid } },
          ],
        },
      ],
    };
    spawnScene(app, scene);
    await server.settle();
    applyCompletedLoads(server);

    let component: InstanceType<typeof pbr.MeshMaterial3d> | undefined;
    for (const entity of app.world.entities()) {
      const found = app.world.getComponent(entity, pbr.MeshMaterial3d);
      if (found !== undefined) component = found;
    }
    expect(component).toBeDefined();
    expect(app.getResource(pbr.Materials)!.get(component!.handle)?.roughness).toBeCloseTo(0.3, 5);
  });

  it('draws a scene-loaded material mesh (prepare → queue → draw)', async () => {
    const { renderer, log } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.addPlugin(new StandardMaterialPlugin());
    const pbr = new MaterialPlugin(StandardMaterial);
    app.addPlugin(pbr);
    app.addPlugin(new Light3dPlugin());
    const files = new Map<string, Uint8Array>();
    app.addPlugin(new AssetPlugin({ source: new MemoryAssetSource(files) }));

    files.set('mesh.rmesh', createMeshSerializer().serialize(buildCube()));
    files.set(
      'mat.remat',
      createMaterialSerializer<StandardMaterial>(app, StandardMaterial).serialize(
        new StandardMaterial({ metallic: 0.2, roughness: 0.5 }),
      ),
    );

    const meshGuid = generateAssetGuid();
    const matGuid = generateAssetGuid();
    const server = app.getResource(AssetServer)!;
    server.setManifest({
      entries: new Map([
        [meshGuid, { guid: meshGuid, location: 'mesh.rmesh', kind: 'Mesh' }],
        [matGuid, { guid: matGuid, location: 'mat.remat', kind: 'StandardMaterial' }],
      ]),
    });
    server.registerLoader('rmesh', app.getResource(Meshes)!, createMeshImporter());
    registerMaterialLoaders(app);

    const camT = new Transform();
    camT.translation = vec3.create(0.5, 0.5, 3);
    app.world.spawn(...Camera3d({ transform: camT }));
    app.world.spawn(new DirectionalLight3d({ color: vec3.create(1, 1, 1), intensity: 3 }), new Transform());
    spawnScene(app, {
      version: SCENE_FORMAT_VERSION,
      entities: [
        {
          id: 0,
          components: [
            { type: 'Transform', version: 1, data: { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } },
            { type: 'Visibility', version: 1, data: { mode: 'Visible' } },
            { type: 'Mesh3d', version: 1, data: { handle: meshGuid } },
            { type: 'MeshMaterial3d<StandardMaterial>', version: 1, data: { handle: matGuid } },
          ],
        },
      ],
    });

    await app.run();
    await server.settle();
    // A few frames for the async loads to drain, the mesh + material to prepare,
    // and the queue to draw — the entity references both assets only by GUID.
    for (let i = 0; i < 6; i++) app.advanceFrame(16 * (i + 1));

    const drew = log.passes
      .filter((p) => p.label?.endsWith('.opaque3d'))
      .some((p) => p.drawCalls.some((c) => c.kind === 'drawIndexed' || c.kind === 'draw'));
    expect(drew).toBe(true);
  });
});
