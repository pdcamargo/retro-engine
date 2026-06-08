import { describe, expect, it } from 'bun:test';

import { vec3 } from '@retro-engine/math';
import { t } from '@retro-engine/reflect';

import {
  App,
  defineTemplate,
  GlobalTransform,
  InheritedVisibility,
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

describe('spawnTemplate', () => {
  it('spawns with params substituted and Required Components resolved', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const Enemy = defineTemplate({
      name: 'Enemy',
      params: {
        position: t.vec3.default(() => vec3.create(0, 0, 0)),
        health: t.number.default(() => 100),
      },
      build: ({ position, health }) => [
        new Transform(position),
        new Visibility('Visible'),
        new Health(health, health),
      ],
    });

    const entity = spawnTemplate(app, Enemy, { position: vec3.create(3, 4, 5), health: 250 });

    // Params substituted into the produced components.
    expect(Array.from(app.world.getComponent(entity, Transform)!.translation)).toEqual([3, 4, 5]);
    const health = app.world.getComponent(entity, Health)!;
    expect(health.current).toBe(250);
    expect(health.max).toBe(250);

    // Required Components pulled in by Transform / Visibility on insert (resolveBundle).
    expect(app.world.getComponent(entity, GlobalTransform)).toBeDefined();
    expect(app.world.getComponent(entity, InheritedVisibility)).toBeDefined();
    expect(app.world.getComponent(entity, ViewVisibility)).toBeDefined();
  });

  it('applies param defaults when omitted', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const Enemy = defineTemplate({
      name: 'EnemyDefaults',
      params: { health: t.number.default(() => 100) },
      build: ({ health }) => [new Health(health, health)],
    });

    const entity = spawnTemplate(app, Enemy);
    expect(app.world.getComponent(entity, Health)!.current).toBe(100);
  });

  it('resolves a template by its registered stable name', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    app.registerTemplate(
      defineTemplate({
        name: 'Named',
        params: { health: t.number.default(() => 7) },
        build: ({ health }) => [new Health(health, health)],
      }),
    );

    const entity = spawnTemplate(app, 'Named', { health: 42 });
    expect(app.world.getComponent(entity, Health)!.current).toBe(42);
  });

  it('throws when a required param is missing', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const NeedsParam = defineTemplate({
      name: 'NeedsParam',
      params: { health: t.number },
      build: ({ health }) => [new Health(health, health)],
    });
    expect(() => spawnTemplate(app, NeedsParam)).toThrow(/missing required template param 'health'/);
  });

  it('throws when spawning an unregistered template name', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    expect(() => spawnTemplate(app, 'Nope')).toThrow(/no template registered as 'Nope'/);
  });
});
