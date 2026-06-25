import { describe, expect, it } from 'bun:test';

import type { AssetSource } from '@retro-engine/assets';
import type { Entity } from '@retro-engine/ecs';
import {
  AnimationClips,
  App,
  AssetPlugin,
  AssetServer,
  Assets,
  asAssetIndex,
  Children,
  GlobalTransform,
  Mesh3d,
  makeHandle,
  Name,
  Parent,
  Skeleton,
  Transform,
} from '@retro-engine/engine';
import type { Handle, Image as ImageType, Mesh, StandardMaterial } from '@retro-engine/engine';

import { makeStubRenderer } from './app-test-support';
import type { MappedGltfAssets } from './asset-mapping';
import { buildGltfRoot } from './build-gltf-root';
import { GltfInstanceNodes, GltfSceneRoot } from './gltf-components';
import { addGltfInstantiation } from './gltf-instantiate';
import { createGltfImporter } from './gltf-importer';
import type { Gltf } from './gltf-root';
import { Gltfs } from './gltf-root';
import { rawBytes, stubDecoder } from './mapping-test-support';
import type { GltfDocument } from './schema';

/** Stand-in for the renderer's StandardMaterial-typed `MeshMaterial3d` subclass. */
class StubMeshMaterial3d {
  constructor(readonly handle: Handle<StandardMaterial>) {}
}

const meshH = (i: number) => makeHandle<Mesh>(asAssetIndex(i));
const matH = (i: number) => makeHandle<StandardMaterial>(asAssetIndex(i));

const meshMapped = (primCounts: readonly number[]): MappedGltfAssets => ({
  meshes: primCounts.map((n, mi) => ({
    primitives: Array.from({ length: n }, (_, pi) => ({ mesh: meshH(mi * 10 + pi), material: matH(0) })),
  })),
  materials: [matH(0)],
  images: [],
  animationClips: [],
});

/** Build a headless app with the reactor installed and a `Gltf` already in its store. */
const setup = (gltf: Gltf): { app: App; gltfs: Gltfs; handle: Handle<Gltf> } => {
  const app = new App({ renderer: makeStubRenderer() });
  const gltfs = new Gltfs();
  app.insertResource(gltfs);
  addGltfInstantiation(app, StubMeshMaterial3d);
  const handle = gltfs.add(gltf);
  return { app, gltfs, handle };
};

describe('gltf instantiation reactor — entity tree', () => {
  it('mirrors the node graph with correct parenting and transforms', () => {
    const document: GltfDocument = {
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [
        { name: 'root', translation: [1, 0, 0], children: [1] },
        { name: 'child', translation: [0, 2, 0] },
      ],
    };
    const { app, handle } = setup(buildGltfRoot(document, { meshes: [], materials: [], images: [], animationClips: [] }));
    const anchor = app.world.spawn(new GltfSceneRoot(handle), new Transform());
    app.advanceFrame(0);

    const nodes = app.world.getComponent(anchor, GltfInstanceNodes)!;
    const node0 = nodes.nodeEntities[0]!;
    const node1 = nodes.nodeEntities[1]!;

    expect(app.world.getComponent(node0, Parent)!.entity).toBe(anchor);
    expect(app.world.getComponent(node1, Parent)!.entity).toBe(node0);
    expect(app.world.getComponent(anchor, Children)!.entities).toContain(node0);
    expect(app.world.getComponent(node0, Children)!.entities).toContain(node1);

    expect(app.world.getComponent(node0, Name)!.value).toBe('root');
    expect(app.world.getComponent(node0, Transform)!.translation[0]).toBe(1);

    // node1 global = anchor(identity) ∘ node0(1,0,0) ∘ node1(0,2,0) = (1, 2, 0).
    const g1 = app.world.getComponent(node1, GlobalTransform)!;
    expect(g1.matrix[12]).toBeCloseTo(1, 5);
    expect(g1.matrix[13]).toBeCloseTo(2, 5);
  });

  it('gives an unnamed node no Name component', () => {
    const document: GltfDocument = {
      asset: { version: '2.0' },
      scenes: [{ nodes: [0] }],
      scene: 0,
      nodes: [{}],
    };
    const { app, handle } = setup(buildGltfRoot(document, { meshes: [], materials: [], images: [], animationClips: [] }));
    const anchor = app.world.spawn(new GltfSceneRoot(handle), new Transform());
    app.advanceFrame(0);
    const node0 = app.world.getComponent(anchor, GltfInstanceNodes)!.nodeEntities[0]!;
    expect(app.world.getComponent(node0, Name)).toBeUndefined();
  });
});

describe('gltf instantiation reactor — name lookup', () => {
  it('finds named nodes, and reaches every node sharing a name', () => {
    const document: GltfDocument = {
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [
        { name: 'rig', children: [1, 2] },
        { name: 'leaf' },
        { name: 'leaf' },
      ],
    };
    const { app, handle } = setup(buildGltfRoot(document, { meshes: [], materials: [], images: [], animationClips: [] }));
    const anchor = app.world.spawn(new GltfSceneRoot(handle), new Transform());
    app.advanceFrame(0);

    const nodes = app.world.getComponent(anchor, GltfInstanceNodes)!;
    expect(nodes.findByName('rig')).toBe(nodes.nodeEntities[0]);
    expect(nodes.findByName('leaf')).toBe(nodes.nodeEntities[1]); // first in document order
    expect(nodes.findAllByName('leaf')).toEqual([nodes.nodeEntities[1]!, nodes.nodeEntities[2]!]);
    expect(nodes.findByName('missing')).toBeUndefined();
  });
});

describe('gltf instantiation reactor — primitive → entity model', () => {
  it('puts a single primitive on the node entity itself', () => {
    const document: GltfDocument = {
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ name: 'solo', mesh: 0 }],
      meshes: [{ primitives: [] }],
    };
    const { app, handle } = setup(buildGltfRoot(document, meshMapped([1])));
    const anchor = app.world.spawn(new GltfSceneRoot(handle), new Transform());
    app.advanceFrame(0);

    const node0 = app.world.getComponent(anchor, GltfInstanceNodes)!.nodeEntities[0]!;
    expect(app.world.getComponent(node0, Mesh3d)).toBeDefined();
    expect(app.world.getComponent(node0, StubMeshMaterial3d)).toBeDefined();
  });

  it('splits a multi-primitive node into one child entity per primitive', () => {
    const document: GltfDocument = {
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ name: 'multi', mesh: 0 }],
      meshes: [{ primitives: [] }],
    };
    const { app, handle } = setup(buildGltfRoot(document, meshMapped([3])));
    const anchor = app.world.spawn(new GltfSceneRoot(handle), new Transform());
    app.advanceFrame(0);

    const node0 = app.world.getComponent(anchor, GltfInstanceNodes)!.nodeEntities[0]!;
    expect(app.world.getComponent(node0, Mesh3d)).toBeUndefined(); // anchor only
    const children = app.world.getComponent(node0, Children)!.entities;
    expect(children).toHaveLength(3);
    for (const child of children) {
      expect(app.world.getComponent(child, Mesh3d)).toBeDefined();
      expect(app.world.getComponent(child, StubMeshMaterial3d)).toBeDefined();
    }
  });
});

describe('gltf instantiation reactor — once-guard', () => {
  it('instantiates each root exactly once across frames', () => {
    const document: GltfDocument = {
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ name: 'a', mesh: 0 }],
      meshes: [{ primitives: [] }],
    };
    const { app, handle } = setup(buildGltfRoot(document, meshMapped([1])));
    app.world.spawn(new GltfSceneRoot(handle), new Transform());

    app.advanceFrame(0);
    const after1 = [...app.world.query([Mesh3d])].length;
    app.advanceFrame(16);
    const after2 = [...app.world.query([Mesh3d])].length;

    expect(after1).toBe(1);
    expect(after2).toBe(1);
  });
});

describe('gltf instantiation reactor — failed import commits no subgraph', () => {
  it('does not instantiate and leaves all stores empty when the import fails', async () => {
    const source: AssetSource = {
      read: (location) =>
        location === 'bad.gltf'
          ? Promise.resolve(
              new TextEncoder().encode(
                JSON.stringify({ asset: { version: '2.0' }, extensionsRequired: ['KHR_unknown'] }),
              ),
            )
          : Promise.reject(new Error(`missing: ${location}`)),
    };

    const app = new App({ renderer: makeStubRenderer() });
    app.addPlugin(new AssetPlugin({ source }));
    const server = app.getResource(AssetServer)!;
    const gltfs = new Gltfs();
    app.insertResource(gltfs);
    const meshes = new Assets<Mesh>();
    const materials = new Assets<StandardMaterial>();
    const images = new Assets<ImageType>();
    const animationClips = new AnimationClips();
    server.registerLoader(
      'gltf',
      gltfs,
      createGltfImporter({ meshes, materials, images, animationClips }, stubDecoder),
    );
    addGltfInstantiation(app, StubMeshMaterial3d);

    const handle = server.load<Gltf>('bad.gltf');
    const anchor: Entity = app.world.spawn(new GltfSceneRoot(handle), new Transform());
    await server.settle();
    app.advanceFrame(0);

    expect(gltfs.get(handle)).toBeUndefined();
    expect(app.world.getComponent(anchor, GltfInstanceNodes)).toBeUndefined();
    expect(app.world.getComponent(anchor, Children)).toBeUndefined();
    expect([...meshes.iter()]).toHaveLength(0);
    expect([...materials.iter()]).toHaveLength(0);
  });
});

describe('gltf instantiation reactor — skinning', () => {
  it('attaches a Skeleton resolving skin joints to bone entities with decoded inverse binds', () => {
    // Two inverse-bind matrices: identity for joint 0, translate(0,-1,0) for
    // joint 1 (the inverse of a bind at y=1).
    const ibm = new Float32Array(32);
    ibm.set(
      [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], // joint 0 = identity
      0,
    );
    ibm.set(
      [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -1, 0, 1], // joint 1 = translate(0,-1,0)
      16,
    );
    const document: GltfDocument = {
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0, 1, 2] }],
      nodes: [
        { name: 'mesh', mesh: 0, skin: 0 },
        { name: 'joint0' },
        { name: 'joint1', translation: [0, 1, 0] },
      ],
      skins: [{ joints: [1, 2], inverseBindMatrices: 0 }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 2, type: 'MAT4' }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: ibm.byteLength }],
    };
    const gltf = buildGltfRoot(document, meshMapped([1]), [rawBytes(ibm)]);
    const { app, handle } = setup(gltf);
    const anchor = app.world.spawn(new GltfSceneRoot(handle), new Transform());
    app.advanceFrame(0);

    const nodes = app.world.getComponent(anchor, GltfInstanceNodes)!;
    const meshEntity = nodes.nodeEntities[0]!;
    const joint0 = nodes.nodeEntities[1]!;
    const joint1 = nodes.nodeEntities[2]!;

    const skeleton = app.world.getComponent(meshEntity, Skeleton)!;
    expect(skeleton).toBeDefined();
    expect(skeleton.joints).toEqual([joint0, joint1]);
    expect(skeleton.inverseBindMatrices).toHaveLength(2);
    // Inverse bind for joint 1 carries the y=-1 translation in the last column.
    expect(skeleton.inverseBindMatrices[1]![13]).toBeCloseTo(-1, 5);
  });

  it('does not attach a Skeleton to an unskinned mesh node', () => {
    const document: GltfDocument = {
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ name: 'mesh', mesh: 0 }],
    };
    const gltf = buildGltfRoot(document, meshMapped([1]), []);
    const { app, handle } = setup(gltf);
    const anchor = app.world.spawn(new GltfSceneRoot(handle), new Transform());
    app.advanceFrame(0);

    const nodes = app.world.getComponent(anchor, GltfInstanceNodes)!;
    expect(app.world.getComponent(nodes.nodeEntities[0]!, Skeleton)).toBeUndefined();
  });
});
