import { describe, expect, it } from 'bun:test';

import { t } from '@retro-engine/reflect';

import {
  App,
  defineTemplate,
  GlobalTransform,
  InheritedVisibility,
  type SceneData,
  spawnScene,
  spawnTemplate,
  Transform,
  ViewVisibility,
  Visibility,
} from '../index';
import { makeHeadlessRenderer } from '../test-utils';

class Health {
  constructor(
    public current = 0,
    public max = 0,
  ) {}
}

/** App with `Health` registered (so a field-level override can resolve its schema) and a `Mob` template. */
const buildApp = (): App => {
  const app = new App({ renderer: makeHeadlessRenderer() });
  app.registerComponent(Health, { current: t.number, max: t.number }, { name: 'Health' });
  app.registerTemplate(
    defineTemplate({
      name: 'Mob',
      params: { hp: t.number.default(() => 100) },
      build: ({ hp }) => [new Transform(), new Visibility('Visible'), new Health(hp, hp)],
    }),
  );
  return app;
};

/** Force a scene through JSON so the test proves it is plain, serializable data. */
const roundTrip = (scene: SceneData): SceneData => JSON.parse(JSON.stringify(scene)) as SceneData;

describe('spawnScene — embedded templates', () => {
  it('expands an embedded template ref with params, resolving Required Components', () => {
    const app = buildApp();
    const idMap = spawnScene(
      app,
      roundTrip({
        version: 1,
        entities: [{ id: 0, components: [], templates: [{ template: 'Mob', params: { hp: 250 } }] }],
      }),
    );

    const entity = idMap.get(0)!;
    expect(app.world.getComponent(entity, Health)!.current).toBe(250);
    expect(app.world.getComponent(entity, GlobalTransform)).toBeDefined();
    expect(app.world.getComponent(entity, InheritedVisibility)).toBeDefined();
    expect(app.world.getComponent(entity, ViewVisibility)).toBeDefined();
  });

  it('applies the template param defaults when the ref omits them', () => {
    const app = buildApp();
    const idMap = spawnScene(
      app,
      roundTrip({ version: 1, entities: [{ id: 0, components: [], templates: [{ template: 'Mob' }] }] }),
    );
    expect(app.world.getComponent(idMap.get(0)!, Health)!.current).toBe(100);
  });

  it('overlays a field-level override onto a produced component, keeping its other fields', () => {
    const app = buildApp();
    // template hp=80 → Health(80, 80); the override touches only `current`.
    const idMap = spawnScene(
      app,
      roundTrip({
        version: 1,
        entities: [
          {
            id: 0,
            components: [],
            templates: [
              {
                template: 'Mob',
                params: { hp: 80 },
                overrides: [{ type: 'Health', data: { current: 60 } }],
              },
            ],
          },
        ],
      }),
    );

    const health = app.world.getComponent(idMap.get(0)!, Health)!;
    expect(health.current).toBe(60); // overridden for this instance
    expect(health.max).toBe(80); // kept from the template
  });

  it('expands to state identical to the code-path spawn of the same template', () => {
    const app = buildApp();
    const codeEntity = spawnTemplate(app, 'Mob', { hp: 42 });
    const sceneEntity = spawnScene(
      app,
      roundTrip({
        version: 1,
        entities: [{ id: 0, components: [], templates: [{ template: 'Mob', params: { hp: 42 } }] }],
      }),
    ).get(0)!;

    const fromCode = app.world.getComponent(codeEntity, Health)!;
    const fromScene = app.world.getComponent(sceneEntity, Health)!;
    expect(fromScene.current).toBe(fromCode.current);
    expect(fromScene.max).toBe(fromCode.max);
    expect(app.world.getComponent(sceneEntity, GlobalTransform)).toBeDefined();
  });

  it('throws when a ref names an unregistered template', () => {
    const app = buildApp();
    const scene = roundTrip({
      version: 1,
      entities: [{ id: 0, components: [], templates: [{ template: 'Ghost' }] }],
    });
    expect(() => spawnScene(app, scene)).toThrow(/unregistered template 'Ghost'/);
  });
});
