import { describe, expect, it } from 'bun:test';

import type { Entity } from '@retro-engine/ecs';
import { vec3 } from '@retro-engine/math';
import { t } from '@retro-engine/reflect';

import { App, applyTemplate, Commands, defineTemplate, Name, Transform } from '../index';
import { makeHeadlessRenderer } from '../test-utils';

class Health {
  constructor(
    public current = 0,
    public max = 0,
  ) {}
}
/** Marker the patch adds. */
class Damaged {}

describe('applyTemplate', () => {
  it('patches an existing entity: overwrites a component, adds a new one, leaves the rest intact', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });

    let entity!: Entity;
    app.addSystem('startup', [Commands], (cmd) => {
      entity = cmd.spawn(
        new Transform(vec3.create(1, 2, 3)),
        new Name('hero'),
        new Health(100, 100),
      ).id;
    });
    app.advanceFrame(0);

    const Damage = defineTemplate({
      name: 'Damage',
      params: { current: t.number.default(() => 30) },
      build: ({ current }) => [new Health(current, 100), new Damaged()],
    });
    applyTemplate(app, entity, Damage, { current: 25 });

    // Overwritten: the existing Health value is replaced.
    expect(app.world.getComponent(entity, Health)!.current).toBe(25);
    // Added: a component the entity did not have.
    expect(app.world.getComponent(entity, Damaged)).toBeDefined();
    // Untouched: components the patch never mentions survive unchanged.
    expect(app.world.getComponent(entity, Name)!.value).toBe('hero');
    expect(Array.from(app.world.getComponent(entity, Transform)!.translation)).toEqual([1, 2, 3]);
  });

  it('resolves a patch template by its registered name', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    app.registerTemplate(
      defineTemplate({
        name: 'MarkDamaged',
        build: () => [new Damaged()],
      }),
    );

    let entity!: Entity;
    app.addSystem('startup', [Commands], (cmd) => {
      entity = cmd.spawn(new Name('mob')).id;
    });
    app.advanceFrame(0);

    applyTemplate(app, entity, 'MarkDamaged');
    expect(app.world.getComponent(entity, Damaged)).toBeDefined();
  });
});
