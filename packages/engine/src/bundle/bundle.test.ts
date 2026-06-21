import { describe, expect, it } from 'bun:test';
import { t } from '@retro-engine/reflect';

import { App, AppBundleRegistry, instantiateBundle } from '../index';
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

describe('App.registerBundle', () => {
  it('captures authored defaults and stores the bundle in the registry', () => {
    const app = newApp();
    app.registerBundle('Enemy', [new Health(30, 30), new Label('goblin')], {
      category: ['Gameplay'],
      icon: 'skull',
    });

    const registry = app.getResource(AppBundleRegistry)!;
    const def = registry.get('Enemy');
    expect(def).toBeDefined();
    expect(def!.components.map((c) => c.type)).toEqual(['Health', 'Label']);
    expect(def!.category).toEqual(['Gameplay']);
    expect(registry.all()).toHaveLength(1);
  });

  it('throws when a bundle component type is not registered', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    expect(() => app.registerBundle('Bad', [new Health()])).toThrow(/not registered/);
  });
});

describe('instantiateBundle', () => {
  it('yields fresh, independent instances carrying the authored defaults', () => {
    const app = newApp();
    const def = app.registerBundle('Enemy', [new Health(30, 30), new Label('goblin')]);

    const a = instantiateBundle(app, def);
    const b = instantiateBundle(app, def);

    expect(a).toHaveLength(2);
    const healthA = a.find((c) => c instanceof Health) as Health;
    const labelA = a.find((c) => c instanceof Label) as Label;
    expect(healthA.current).toBe(30);
    expect(labelA.text).toBe('goblin');

    // Independent: mutating one spawn never touches another.
    healthA.current = 1;
    const healthB = b.find((c) => c instanceof Health) as Health;
    expect(healthB.current).toBe(30);
  });

  it('spawns onto an entity via the bundle instances', () => {
    const app = newApp();
    const def = app.registerBundle('Enemy', [new Health(30, 30), new Label('goblin')]);
    const entity = app.world.spawn(...instantiateBundle(app, def));

    expect(app.world.getComponent(entity, Health)?.current).toBe(30);
    expect(app.world.getComponent(entity, Label)?.text).toBe('goblin');
  });
});
