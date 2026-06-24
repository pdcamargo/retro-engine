import { describe, expect, it } from 'bun:test';

import type { AssetSource } from '@retro-engine/assets';
import type { Entity } from '@retro-engine/ecs';

import {
  App,
  AssetPlugin,
  type CompositionProvider,
  CompositionRegistry,
  Name,
  Parent,
  PendingAttachment,
  type SceneData,
  ScenePlugin,
  type SerializedEntity,
} from '../index';
import { serializeScene } from './serialize';
import { spawnScene } from './spawn';
import { makeHeadlessRenderer } from '../test-utils';

const emptySource: AssetSource = {
  read: (location) => Promise.reject(new Error(`missing: ${location}`)),
};

/** Identifies the entities the stub provider treats as a derived subtree. */
class Marker {}

const named = (value: string): SceneData['entities'][number]['components'][number] => ({
  type: 'Name',
  version: 1,
  data: { value },
});
const parentTo = (id: number): SceneData['entities'][number]['components'][number] => ({
  type: 'Parent',
  version: 1,
  data: { entity: id },
});
const marker = (): SceneData['entities'][number]['components'][number] => ({
  type: 'Marker',
  version: 1,
  data: {},
});

/**
 * A provider standing in for a real composition source (e.g. glTF): it derives
 * any entity carrying {@link Marker}, and re-expresses a parent edge onto a
 * marked entity as an anchor on that entity's own parent (the "mount").
 */
const stubProvider: CompositionProvider = {
  *excluded(world) {
    for (const entity of world.entities()) {
      if (world.getComponent(entity, Marker) !== undefined) yield entity;
    }
  },
  anchorFor(world, derived) {
    if (world.getComponent(derived, Marker) === undefined) return undefined;
    const parent = world.getComponent(derived, Parent);
    if (parent === undefined) return undefined;
    return { mount: parent.entity, kind: 'stub', anchor: { tag: 'bone' } };
  },
};

const buildApp = (): App => {
  const app = new App({ renderer: makeHeadlessRenderer() });
  app.addPlugin(new AssetPlugin({ source: emptySource }));
  app.addPlugin(new ScenePlugin());
  app.advanceFrame(0); // build plugins + register core components
  app.registerComponent(Marker, {}, { name: 'Marker' });
  app.getResource(CompositionRegistry)!.register(stubProvider);
  return app;
};

const findByName = (app: App, name: string): Entity | undefined => {
  for (const entity of app.world.entities()) {
    if (app.world.getComponent(entity, Name)?.value === name) return entity;
  }
  return undefined;
};

const entry = (scene: SceneData, name: string): SerializedEntity | undefined =>
  scene.entities.find((e) =>
    e.components.some((c) => c.type === 'Name' && (c.data as { value: string }).value === name),
  );

// A Mount, a derived Bone (its child, marked), and an authored Sword parented
// onto the Bone — the cross-boundary edge the seam must round-trip as an anchor.
const sourceScene: SceneData = {
  version: 1,
  entities: [
    { id: 0, components: [named('Mount')] },
    { id: 1, components: [named('Bone'), parentTo(0), marker()] },
    { id: 2, components: [named('Sword'), parentTo(1)] },
  ],
};

describe('scene attachment seam (ADR-0112)', () => {
  it('save: re-emits a cross-boundary parent as `attach`, excludes the derived subtree, drops no dangling Parent', () => {
    const app = buildApp();
    spawnScene(app, sourceScene);

    const saved = JSON.parse(JSON.stringify(serializeScene(app))) as SceneData;

    // The Bone (derived) is excluded; Mount and Sword persist.
    expect(entry(saved, 'Bone')).toBeUndefined();
    expect(entry(saved, 'Mount')).toBeDefined();
    const sword = entry(saved, 'Sword')!;

    // The Sword carries an anchor, not a (dangling) Parent.
    expect(sword.components.some((c) => c.type === 'Parent')).toBe(false);
    expect(sword.attach).toBeDefined();
    expect(sword.attach!.kind).toBe('stub');
    expect(sword.attach!.anchor).toEqual({ tag: 'bone' });
    // It anchors to the Mount's in-scene id, which round-trips as an ordinary ref.
    expect(sword.attach!.to).toBe(entry(saved, 'Mount')!.id);
  });

  it('load: turns `attach` into a PendingAttachment on the right mount, with no Parent', () => {
    const app = buildApp();
    spawnScene(app, sourceScene);
    const saved = JSON.parse(JSON.stringify(serializeScene(app))) as SceneData;

    const fresh = buildApp();
    spawnScene(fresh, saved);

    const sword = findByName(fresh, 'Sword')!;
    const mount = findByName(fresh, 'Mount')!;
    expect(fresh.world.getComponent(sword, Parent)).toBeUndefined();
    const pending = fresh.world.getComponent(sword, PendingAttachment);
    expect(pending).toBeInstanceOf(PendingAttachment);
    expect(pending!.to).toBe(mount);
    expect(pending!.kind).toBe('stub');
    expect(pending!.anchor).toEqual({ tag: 'bone' });
  });
});
