import { describe, expect, it } from 'bun:test';

import { t } from '@retro-engine/reflect';

import { App, AppTypeRegistry, type PluginObject, Query, serializeScene, spawnScene } from './index';
import { makeCapturingRenderer, makeStubCanvas } from './test-utils';

const buildApp = (): App => {
  const { renderer } = makeCapturingRenderer();
  return new App({ renderer, canvas: makeStubCanvas() });
};

const baselineOf = (app: App): { components: ReadonlySet<string>; resources: ReadonlySet<string> } => {
  const atr = app.getResource(AppTypeRegistry)!;
  return {
    components: new Set([...atr.registry.components()].map((r) => r.name)),
    resources: new Set([...atr.resources.values()].map((r) => r.name)),
  };
};

const hasSystem = (app: App, name: string): boolean =>
  app.describeSchedule().some((g) => g.systems.some((s) => s.name === name));

describe('hot reload — live plugin swap', () => {
  it('removes a user plugin’s systems + components, then re-adds the rebuilt ones', () => {
    const app = buildApp();
    const baseline = baselineOf(app);

    class Health {
      current = 100;
    }
    const v1: PluginObject = {
      name: () => 'HealthPlugin',
      category: () => 'user',
      build: (a) => {
        a.registerComponent(Health, { current: t.number });
        a.addSystem('update', [Query([Health])], () => undefined, { name: 'health-regen' });
      },
    };
    app.addPlugin(v1);
    app.advanceFrame(); // leave Building → running

    const atr = app.getResource(AppTypeRegistry)!;
    expect(atr.registry.get('Health')?.ctor).toBe(Health);
    expect(hasSystem(app, 'health-regen')).toBe(true);

    app.removeUserPlugins(baseline);
    expect(atr.registry.get('Health')).toBeUndefined();
    expect(hasSystem(app, 'health-regen')).toBe(false);

    // A rebuild produces a NEW class under the SAME stable name (ctor.name is
    // stable across reloads; simulated here with an explicit name).
    class HealthReloaded {
      current = 0;
    }
    const v2: PluginObject = {
      name: () => 'HealthPlugin',
      category: () => 'user',
      build: (a) => {
        a.registerComponent(HealthReloaded, { current: t.number }, { name: 'Health' });
        a.addSystem('update', [Query([HealthReloaded])], () => undefined, { name: 'health-regen' });
      },
    };
    app.addPluginsHot([v2]);
    expect(atr.registry.get('Health')?.ctor).toBe(HealthReloaded);
    expect(hasSystem(app, 'health-regen')).toBe(true);
  });

  it('preserves world data across the swap via serialize → respawn', () => {
    const app = buildApp();
    const baseline = baselineOf(app);

    class Health {
      current = 0;
    }
    app.addPlugin({
      name: () => 'HealthPlugin',
      category: () => 'user',
      build: (a) => a.registerComponent(Health, { current: t.number }),
    });
    app.advanceFrame();

    const e = app.world.spawn();
    app.world.entity(e).insert(Object.assign(new Health(), { current: 77 }));

    // Snapshot against the current registry, then swap to a rebuilt class.
    const snapshot = JSON.parse(JSON.stringify(serializeScene(app))) as ReturnType<typeof serializeScene>;
    app.world.despawn(e);
    app.removeUserPlugins(baseline);

    class HealthReloaded {
      current = -1;
    }
    app.addPluginsHot([
      {
        name: () => 'HealthPlugin',
        category: () => 'user',
        build: (a) => a.registerComponent(HealthReloaded, { current: t.number }, { name: 'Health' }),
      },
    ]);
    spawnScene(app, snapshot);

    let found: HealthReloaded | undefined;
    for (const entity of app.world.entities()) {
      const h = app.world.getComponent(entity, HealthReloaded);
      if (h !== undefined) found = h;
    }
    expect(found).toBeInstanceOf(HealthReloaded);
    expect(found?.current).toBe(77);
  });
});
