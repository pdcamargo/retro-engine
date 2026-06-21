import { describe, expect, it } from 'bun:test';
import { t } from '@retro-engine/reflect';

import {
  App,
  AppBundleRegistry,
  type BundleDefinition,
  deserializeBundle,
  instantiateBundle,
  serializeBundle,
} from '../index';
import { makeHeadlessRenderer } from '../test-utils';

class Health {
  constructor(public current = 100, public max = 100) {}
}

class Label {
  constructor(public text = '') {}
}

const newApp = (): App => {
  const app = new App({ renderer: makeHeadlessRenderer() });
  app.registerComponent(Health, { current: t.number, max: t.number }, { name: 'Health' });
  app.registerComponent(Label, { text: t.string }, { name: 'Label' });
  return app;
};

describe('.rebundle round-trip', () => {
  it('serializes and deserializes a bundle preserving its components and name', () => {
    const app = newApp();
    const def = app.registerBundle('Enemy', [new Health(30, 30), new Label('goblin')]);

    const restored = deserializeBundle(serializeBundle(def));

    expect(restored.name).toBe('Enemy');
    expect(restored.components).toEqual(def.components);
  });

  it('a restored bundle instantiates with the authored defaults', () => {
    const authoring = newApp();
    const bytes = serializeBundle(
      authoring.registerBundle('Enemy', [new Health(30, 30), new Label('goblin')]),
    );

    // A fresh App (the "load" side) registers the same components, then loads.
    const loading = newApp();
    const restored = deserializeBundle(bytes);
    loading.getResource(AppBundleRegistry)!.register(restored);

    const components = instantiateBundle(loading, restored);
    expect((components.find((c) => c instanceof Health) as Health).current).toBe(30);
    expect((components.find((c) => c instanceof Label) as Label).text).toBe('goblin');
  });

  it('preserves an asset-handle GUID in a component\'s serialized data', () => {
    // A handle field serializes to its GUID string; the bundle stores it
    // verbatim, so it survives a save/load with no codec involvement.
    const def: BundleDefinition = {
      name: 'WithHandle',
      components: [
        { type: 'MeshRenderer', version: 1, data: { material: 'guid-1234' } },
      ],
    };

    const restored = deserializeBundle(serializeBundle(def));
    expect(restored.components[0]!.data['material']).toBe('guid-1234');
  });

  it('falls back to the provided name when the file omits one', () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify({ formatVersion: 1, components: [] }),
    );
    expect(deserializeBundle(bytes, 'player').name).toBe('player');
  });
});
