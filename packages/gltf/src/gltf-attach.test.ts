import { describe, expect, it } from 'bun:test';

import type { AssetSource, Handle } from '@retro-engine/assets';
import { generateAssetGuid } from '@retro-engine/assets';
import type { Entity } from '@retro-engine/ecs';
import {
  App,
  asAssetIndex,
  AssetPlugin,
  Commands,
  makeHandle,
  Name,
  Parent,
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
import { addGltfInstantiation, addGltfReinstantiation } from './gltf-instantiate';
import type { Gltf } from './gltf-root';
import { Gltfs } from './gltf-root';
import type { GltfDocument } from './schema';

/** Stand-in for the renderer's StandardMaterial-typed `MeshMaterial3d` subclass. */
class StubMeshMaterial3d {
  constructor(readonly handle: Handle<StandardMaterial>) {}
}

const nullSource: AssetSource = { read: () => Promise.reject(new Error('unused')) };
const empty = { meshes: [], materials: [], images: [] };

// A two-node model: a `rig` root with a `hand` child — the bone to attach onto.
const RIG_HAND: GltfDocument = {
  asset: { version: '2.0' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ name: 'rig', children: [1] }, { name: 'hand' }],
};

// Same names, different node indices (a `spine` shifts `hand` from index 1 to 2)
// — stands in for a re-export that reordered nodes.
const RIG_HAND_REORDERED: GltfDocument = {
  asset: { version: '2.0' },
  scene: 0,
  scenes: [{ nodes: [0, 1] }],
  nodes: [{ name: 'spine' }, { name: 'rig', children: [2] }, { name: 'hand' }],
};

// A trivial inner model (for the nested-GLB case).
const BLADE: GltfDocument = {
  asset: { version: '2.0' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ name: 'blade' }],
};

// A lightweight stand-in for GltfPlugin: the glTF systems + component + store
// binding, without the StandardMaterial render pipeline (the models carry no
// meshes, and a real material plugin would pull in the lighting shader modules).
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
  addGltfInstantiation(app, StubMeshMaterial3d);
  addGltfReinstantiation(app);
  addGltfAttach(app);
  return app;
};

const addGltf = (app: App, doc: GltfDocument, guid: string) =>
  app.getResource(Gltfs)!.add(buildGltfRoot(doc, empty) as Gltf, guid as never);

const findByName = (app: App, name: string): Entity | undefined => {
  for (const entity of app.world.entities()) {
    if (app.world.getComponent(entity, Name)?.value === name) return entity;
  }
  return undefined;
};

const nameOf = (e: Entity, app: App): string | undefined =>
  app.world.getComponent(e, Name)?.value;

const entry = (scene: SceneData, name: string): SerializedEntity | undefined =>
  scene.entities.find((e) =>
    e.components.some((c) => c.type === 'Name' && (c.data as { value: string }).value === name),
  );

/** Spawn a named authored entity and parent it under `parent` via the command path. */
const spawnChildOf = (app: App, parent: Entity, components: object[]): Promise<Entity> =>
  new Promise((resolve) => {
    let done = false;
    app.addSystem('update', [Commands], (cmd) => {
      if (done) return;
      done = true;
      const child = cmd.spawn(...components).id;
      cmd.entity(parent).addChild(child);
      resolve(child);
    });
    app.advanceFrame(16);
  });

describe('gltf attachment round-trip (ADR-0112)', () => {
  it('saves an attachment as a node anchor (no baked nodes) and rebinds it on reload', async () => {
    const guid = generateAssetGuid();
    const app = makeApp();
    const handle = addGltf(app, RIG_HAND, guid);
    const root = app.world.spawn(new GltfSceneRoot(handle), new Transform());
    app.advanceFrame(0); // instantiate

    const hand = app.world.getComponent(root, GltfInstanceNodes)!.findByName('hand')!;
    const sword = await spawnChildOf(app, hand, [new Name('Sword'), new Transform()]);
    expect(app.world.getComponent(sword, Parent)!.entity).toBe(hand);

    const saved = JSON.parse(JSON.stringify(serializeScene(app))) as SceneData;

    // Derived nodes are not baked; the GltfSceneRoot persists; the Sword carries
    // an anchor instead of a (dangling) Parent.
    expect(entry(saved, 'rig')).toBeUndefined();
    expect(entry(saved, 'hand')).toBeUndefined();
    const swordSaved = entry(saved, 'Sword')!;
    expect(swordSaved.components.some((c) => c.type === 'Parent')).toBe(false);
    expect(swordSaved.attach?.kind).toBe('gltf-node');
    expect(swordSaved.attach?.anchor).toEqual({ node: 1, path: ['rig', 'hand'] });

    // Reload into a fresh App holding the same model: instantiate + rebind.
    const fresh = makeApp();
    addGltf(fresh, RIG_HAND, guid);
    spawnScene(fresh, saved);
    for (let i = 0; i < 4; i += 1) fresh.advanceFrame(16);

    const freshSword = findByName(fresh, 'Sword')!;
    const freshHand = findByName(fresh, 'hand')!;
    expect(fresh.world.getComponent(freshSword, GltfInstanceNodes)).toBeUndefined();
    expect(fresh.world.getComponent(freshSword, Parent)!.entity).toBe(freshHand);
  });

  it('resolves by name path when node indices shift on re-import', async () => {
    const guid = generateAssetGuid();
    const app = makeApp();
    const root = app.world.spawn(new GltfSceneRoot(addGltf(app, RIG_HAND, guid)), new Transform());
    app.advanceFrame(0);
    const hand = app.world.getComponent(root, GltfInstanceNodes)!.findByName('hand')!;
    await spawnChildOf(app, hand, [new Name('Sword'), new Transform()]);
    const saved = JSON.parse(JSON.stringify(serializeScene(app))) as SceneData;
    expect(entry(saved, 'Sword')!.attach!.anchor).toEqual({ node: 1, path: ['rig', 'hand'] });

    // Reload against a model where `hand` moved to index 2: a bare index would
    // miss (index 1 is now `rig`), but the name path lands on `hand`.
    const fresh = makeApp();
    addGltf(fresh, RIG_HAND_REORDERED, guid);
    spawnScene(fresh, saved);
    for (let i = 0; i < 4; i += 1) fresh.advanceFrame(16);

    const sword = findByName(fresh, 'Sword')!;
    const parent = fresh.world.getComponent(sword, Parent)!.entity;
    expect(nameOf(parent, fresh)).toBe('hand');
  });

  it('round-trips a glTF attached under another glTF bone (nested)', async () => {
    const outerGuid = generateAssetGuid();
    const innerGuid = generateAssetGuid();
    const app = makeApp();
    const outerHandle = addGltf(app, RIG_HAND, outerGuid);
    const innerHandle = addGltf(app, BLADE, innerGuid);
    const root = app.world.spawn(new GltfSceneRoot(outerHandle), new Transform());
    app.advanceFrame(0);
    const hand = app.world.getComponent(root, GltfInstanceNodes)!.findByName('hand')!;
    const swordRoot = await spawnChildOf(app, hand, [
      new Name('SwordRoot'),
      new Transform(),
      new GltfSceneRoot(innerHandle),
    ]);
    // Inner model instantiates under the authored entity.
    app.advanceFrame(16);
    expect(app.world.getComponent(swordRoot, GltfInstanceNodes)!.findByName('blade')).toBeDefined();

    const saved = JSON.parse(JSON.stringify(serializeScene(app))) as SceneData;
    // Neither model's derived nodes are baked; SwordRoot persists with its anchor
    // onto the OUTER mount plus its own GltfSceneRoot.
    expect(entry(saved, 'blade')).toBeUndefined();
    expect(entry(saved, 'hand')).toBeUndefined();
    const sr = entry(saved, 'SwordRoot')!;
    expect(sr.attach?.kind).toBe('gltf-node');
    expect(sr.components.some((c) => c.type === 'GltfSceneRoot')).toBe(true);

    const fresh = makeApp();
    addGltf(fresh, RIG_HAND, outerGuid);
    addGltf(fresh, BLADE, innerGuid);
    spawnScene(fresh, saved);
    for (let i = 0; i < 5; i += 1) fresh.advanceFrame(16);

    const freshSwordRoot = findByName(fresh, 'SwordRoot')!;
    const freshHand = findByName(fresh, 'hand')!;
    expect(fresh.world.getComponent(freshSwordRoot, Parent)!.entity).toBe(freshHand);
    // The inner model survived as its own subtree under the authored entity.
    expect(fresh.world.getComponent(freshSwordRoot, GltfInstanceNodes)!.findByName('blade')).toBeDefined();
  });

  it('re-instantiates on a model swap and keeps the attachment', async () => {
    const app = makeApp();
    const root = app.world.spawn(
      new GltfSceneRoot(addGltf(app, RIG_HAND, generateAssetGuid())),
      new Transform(),
    );
    app.advanceFrame(0);
    const hand = app.world.getComponent(root, GltfInstanceNodes)!.findByName('hand')!;
    const sword = await spawnChildOf(app, hand, [new Name('Sword'), new Transform()]);
    expect(app.world.getComponent(sword, Parent)!.entity).toBe(hand);

    // Swap to a different model instance, marking the root changed.
    const handle2 = addGltf(app, RIG_HAND, generateAssetGuid());
    app.world.insertBundle(root, [new GltfSceneRoot(handle2)]);
    app.world.markChanged(root, GltfSceneRoot);
    for (let i = 0; i < 5; i += 1) app.advanceFrame(16);

    // The old hand is gone; the sword is reattached to the new model's hand.
    expect(app.world.hasEntity(hand)).toBe(false);
    const newHand = app.world.getComponent(root, GltfInstanceNodes)!.findByName('hand')!;
    expect(newHand).not.toBe(hand);
    expect(app.world.getComponent(sword, Parent)!.entity).toBe(newHand);
  });
});
