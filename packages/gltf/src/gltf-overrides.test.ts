import { describe, expect, it } from 'bun:test';

import type { AssetSource, Handle } from '@retro-engine/assets';
import { generateAssetGuid } from '@retro-engine/assets';
import type { Entity } from '@retro-engine/ecs';
import {
  App,
  asAssetIndex,
  AssetPlugin,
  Children,
  CompositionBaseline,
  makeHandle,
  Name,
  registerAssetStore,
  type SceneData,
  type SerializedEntity,
  serializeScene,
  spawnScene,
  type StandardMaterial,
  Transform,
} from '@retro-engine/engine';
import { t } from '@retro-engine/reflect';

import { makeStubRenderer } from './app-test-support';
import { GLTF_ASSET_KIND } from './gltf-asset-kind';
import { addGltfAttach } from './gltf-attach';
import { buildGltfRoot } from './build-gltf-root';
import { GltfInstanceNodes, GltfSceneRoot } from './gltf-components';
import {
  addGltfBaselineCapture,
  addGltfInstantiation,
  addGltfReinstantiation,
} from './gltf-instantiate';
import type { Gltf } from './gltf-root';
import { Gltfs } from './gltf-root';
import type { GltfDocument } from './schema';

/** Stand-in for the renderer's StandardMaterial-typed `MeshMaterial3d` subclass. */
class StubMeshMaterial3d {
  constructor(readonly handle: Handle<StandardMaterial>) {}
}

/** A registered authored component used to exercise the add/remove override paths. */
class Tag {
  constructor(public value: number = 0) {}
}

const nullSource: AssetSource = { read: () => Promise.reject(new Error('unused')) };
const empty = { meshes: [], materials: [], images: [] };

// A two-node model: a `rig` root with a `hand` child — the node to edit.
const RIG_HAND: GltfDocument = {
  asset: { version: '2.0' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ name: 'rig', children: [1] }, { name: 'hand' }],
};

const makeApp = (): App => {
  const app = new App({ renderer: makeStubRenderer() });
  app.addPlugin(new AssetPlugin({ source: nullSource }));
  const gltfs = new Gltfs();
  app.insertResource(gltfs);
  registerAssetStore(app, GLTF_ASSET_KIND, gltfs);
  app.registerComponent(
    GltfSceneRoot,
    { handle: t.handle<Gltf>(GLTF_ASSET_KIND), scene: t.number.optional() },
    { name: 'GltfSceneRoot', make: () => new GltfSceneRoot(makeHandle(asAssetIndex(0))) },
  );
  app.registerComponent(Tag, { value: t.number }, { name: 'Tag' });
  addGltfInstantiation(app, StubMeshMaterial3d);
  addGltfBaselineCapture(app);
  addGltfReinstantiation(app);
  addGltfAttach(app);
  return app;
};

const addGltf = (app: App, doc: GltfDocument, guid: string) =>
  app.getResource(Gltfs)!.add(buildGltfRoot(doc, empty) as Gltf, guid as never);

// A single node `box` whose mesh has two primitives — each spawns its own mesh
// child entity, none of which is a glTF node (so they anchor by `primitive`).
const BOX_TWO_PRIM: GltfDocument = {
  asset: { version: '2.0' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ name: 'box', mesh: 0 }],
};
const twoPrimMapped = {
  meshes: [{ primitives: [{ mesh: makeHandle(asAssetIndex(1)) }, { mesh: makeHandle(asAssetIndex(2)) }] }],
  materials: [],
  images: [],
};
const addBoxModel = (app: App, guid: string) =>
  app.getResource(Gltfs)!.add(buildGltfRoot(BOX_TWO_PRIM, twoPrimMapped as never) as Gltf, guid as never);

/** Instantiate `RIG_HAND` under a fresh mount and run far enough to capture the baseline. */
const instantiated = (guid: string): { app: App; root: Entity; hand: Entity } => {
  const app = makeApp();
  const root = app.world.spawn(new GltfSceneRoot(addGltf(app, RIG_HAND, guid)), new Transform());
  app.advanceFrame(0); // instantiate
  app.advanceFrame(16); // baseline capture (runs the frame after GltfInstanceNodes appears)
  expect(app.world.getComponent(root, CompositionBaseline)).toBeDefined();
  const hand = app.world.getComponent(root, GltfInstanceNodes)!.findByName('hand')!;
  return { app, root, hand };
};

const roundtrip = (saved: SceneData, guid: string): App => {
  const fresh = makeApp();
  addGltf(fresh, RIG_HAND, guid);
  spawnScene(fresh, saved);
  for (let i = 0; i < 6; i += 1) fresh.advanceFrame(16);
  return fresh;
};

const clone = (scene: SceneData): SceneData => JSON.parse(JSON.stringify(scene)) as SceneData;
const mountEntry = (scene: SceneData): SerializedEntity =>
  scene.entities.find((e) => e.components.some((c) => c.type === 'GltfSceneRoot'))!;
const findByName = (app: App, name: string): Entity | undefined => {
  for (const entity of app.world.entities()) {
    if (app.world.getComponent(entity, Name)?.value === name) return entity;
  }
  return undefined;
};
const findMount = (app: App): Entity | undefined => {
  for (const entity of app.world.entities()) {
    if (app.world.getComponent(entity, GltfSceneRoot) !== undefined) return entity;
  }
  return undefined;
};

describe('gltf derived-entity overrides round-trip', () => {
  it('serializes an untouched instance with no derived overrides', () => {
    const { app } = instantiated(generateAssetGuid());
    const saved = clone(serializeScene(app));
    expect(mountEntry(saved).derived).toBeUndefined();
  });

  it('persists a changed component field as a set override', () => {
    const guid = generateAssetGuid();
    const { app, hand } = instantiated(guid);
    const transform = app.world.getComponent(hand, Transform)!;
    transform.translation[0] = 5;
    app.world.markChanged(hand, Transform);

    const saved = clone(serializeScene(app));
    const derived = mountEntry(saved).derived!;
    expect(derived).toHaveLength(1);
    expect(derived[0]!.set).toEqual([{ type: 'Transform', data: { translation: [5, 0, 0] } }]);

    const fresh = roundtrip(saved, guid);
    const freshHand = findByName(fresh, 'hand')!;
    expect(Array.from(fresh.world.getComponent(freshHand, Transform)!.translation)).toEqual([5, 0, 0]);
  });

  it('persists a rename as a Name set override', () => {
    const guid = generateAssetGuid();
    const { app, hand } = instantiated(guid);
    app.world.getComponent(hand, Name)!.value = 'fist';

    const saved = clone(serializeScene(app));
    expect(mountEntry(saved).derived![0]!.set).toEqual([{ type: 'Name', data: { value: 'fist' } }]);

    const fresh = roundtrip(saved, guid);
    // The anchor still resolves by the source's name ('hand'); the override renames it.
    expect(findByName(fresh, 'fist')).toBeDefined();
    expect(findByName(fresh, 'hand')).toBeUndefined();
  });

  it('persists an added component as an add override', () => {
    const guid = generateAssetGuid();
    const { app, hand } = instantiated(guid);
    app.world.insertBundle(hand, [new Tag(7)]);

    const saved = clone(serializeScene(app));
    const add = mountEntry(saved).derived![0]!.add!;
    expect(add).toHaveLength(1);
    expect(add[0]!.type).toBe('Tag');
    expect(add[0]!.data).toEqual({ value: 7 });

    const fresh = roundtrip(saved, guid);
    const freshHand = findByName(fresh, 'hand')!;
    expect(fresh.world.getComponent(freshHand, Tag)!.value).toBe(7);
  });

  it('persists a removed component as a remove override', () => {
    const guid = generateAssetGuid();
    const { app, hand } = instantiated(guid);
    app.world.removeComponent(hand, Name);

    const saved = clone(serializeScene(app));
    // The anchor keeps node index 1 even though the name path is gone with the Name.
    const derived = mountEntry(saved).derived!;
    expect(derived[0]!.remove).toEqual(['Name']);
    expect(derived[0]!.anchor).toMatchObject({ node: 1 });

    // On reload the node re-instantiates as 'hand', then the override removes Name.
    const fresh = roundtrip(saved, guid);
    expect(findByName(fresh, 'hand')).toBeUndefined();
    const mount = findMount(fresh)!;
    const node = fresh.world.getComponent(mount, GltfInstanceNodes)!.nodeEntities[1]!;
    expect(fresh.world.getComponent(node, Name)).toBeUndefined();
    expect(fresh.world.getComponent(node, Transform)).toBeDefined();
  });

  it('persists an edit to a per-primitive mesh child via a primitive anchor', () => {
    const guid = generateAssetGuid();
    const app = makeApp();
    const root = app.world.spawn(new GltfSceneRoot(addBoxModel(app, guid)), new Transform());
    app.advanceFrame(0);
    app.advanceFrame(16);

    const instance = app.world.getComponent(root, GltfInstanceNodes)!;
    const box = instance.nodeEntities[0]!;
    const primChildren = app.world
      .getComponent(box, Children)!
      .entities.filter((c) => instance.nodeEntities.indexOf(c) < 0 && instance.derivedEntities.has(c));
    expect(primChildren).toHaveLength(2);
    app.world.insertBundle(primChildren[1]!, [new Tag(9)]);

    const saved = clone(serializeScene(app));
    const derived = mountEntry(saved).derived!;
    expect(derived).toHaveLength(1);
    expect(derived[0]!.anchor).toMatchObject({ node: 0, primitive: 1 });
    expect(derived[0]!.add![0]!.type).toBe('Tag');

    const fresh = makeApp();
    addBoxModel(fresh, guid);
    spawnScene(fresh, saved);
    for (let i = 0; i < 6; i += 1) fresh.advanceFrame(16);

    const freshMount = findMount(fresh)!;
    const freshInstance = fresh.world.getComponent(freshMount, GltfInstanceNodes)!;
    const freshBox = freshInstance.nodeEntities[0]!;
    const freshPrims = fresh.world
      .getComponent(freshBox, Children)!
      .entities.filter(
        (c) => freshInstance.nodeEntities.indexOf(c) < 0 && freshInstance.derivedEntities.has(c),
      );
    expect(fresh.world.getComponent(freshPrims[0]!, Tag)).toBeUndefined();
    expect(fresh.world.getComponent(freshPrims[1]!, Tag)!.value).toBe(9);
  });

  it('persists a deleted derived node as a deleted override', () => {
    const guid = generateAssetGuid();
    const { app, root, hand } = instantiated(guid);
    app.world.despawn(hand);

    const saved = clone(serializeScene(app));
    const derived = mountEntry(saved).derived!;
    expect(derived).toHaveLength(1);
    expect(derived[0]!.deleted).toBe(true);

    const fresh = roundtrip(saved, guid);
    expect(findByName(fresh, 'hand')).toBeUndefined();
    expect(findByName(fresh, 'rig')).toBeDefined();
    void root;
  });
});
