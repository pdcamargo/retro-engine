import type { Entity } from '@retro-engine/ecs';
import { describe, expect, it } from 'bun:test';

import { App, Commands } from '../index';
import { makeRenderingRenderer, makeStubCanvas } from '../test-utils';
import { InheritedVisibility, Visibility } from './visibility';

const makeApp = () => new App({ renderer: makeRenderingRenderer(), canvas: makeStubCanvas() });

describe('visibilityPropagate (postUpdate, hierarchy walk)', () => {
  it('root Visible → InheritedVisibility.visible = true', async () => {
    const app = makeApp();
    const e = app.world.spawn(new Visibility('Visible'));
    await app.run();
    expect(app.world.getComponent(e, InheritedVisibility)?.visible).toBe(true);
  });

  it('root Hidden → InheritedVisibility.visible = false', async () => {
    const app = makeApp();
    const e = app.world.spawn(new Visibility('Hidden'));
    await app.run();
    expect(app.world.getComponent(e, InheritedVisibility)?.visible).toBe(false);
  });

  it('root Inherited → InheritedVisibility.visible = true (root default)', async () => {
    const app = makeApp();
    const e = app.world.spawn(new Visibility('Inherited'));
    await app.run();
    expect(app.world.getComponent(e, InheritedVisibility)?.visible).toBe(true);
  });

  it('child Inherited under Hidden parent → hidden', async () => {
    const app = makeApp();
    let parent: Entity | undefined;
    let child: Entity | undefined;
    app.addSystem('startup', [Commands], (cmd) => {
      const parentCmd = cmd.spawn(new Visibility('Hidden'));
      parent = parentCmd.id;
      parentCmd.withChildren((p) => {
        const childCmd = p.spawn(new Visibility('Inherited'));
        child = childCmd.id;
      });
    });
    await app.run();
    expect(app.world.getComponent(parent!, InheritedVisibility)?.visible).toBe(false);
    expect(app.world.getComponent(child!, InheritedVisibility)?.visible).toBe(false);
  });

  it('child Visible under Hidden parent → visible (overrides)', async () => {
    const app = makeApp();
    let parent: Entity | undefined;
    let child: Entity | undefined;
    app.addSystem('startup', [Commands], (cmd) => {
      const parentCmd = cmd.spawn(new Visibility('Hidden'));
      parent = parentCmd.id;
      parentCmd.withChildren((p) => {
        const childCmd = p.spawn(new Visibility('Visible'));
        child = childCmd.id;
      });
    });
    await app.run();
    expect(app.world.getComponent(parent!, InheritedVisibility)?.visible).toBe(false);
    expect(app.world.getComponent(child!, InheritedVisibility)?.visible).toBe(true);
  });

  it('three-deep chain: Visible → Hidden → Inherited → hidden at the leaf', async () => {
    const app = makeApp();
    let grand: Entity | undefined;
    let mid: Entity | undefined;
    let leaf: Entity | undefined;
    app.addSystem('startup', [Commands], (cmd) => {
      const g = cmd.spawn(new Visibility('Visible'));
      grand = g.id;
      g.withChildren((p) => {
        const m = p.spawn(new Visibility('Hidden'));
        mid = m.id;
        m.withChildren((p2) => {
          const l = p2.spawn(new Visibility('Inherited'));
          leaf = l.id;
        });
      });
    });
    await app.run();
    expect(app.world.getComponent(grand!, InheritedVisibility)?.visible).toBe(true);
    expect(app.world.getComponent(mid!, InheritedVisibility)?.visible).toBe(false);
    expect(app.world.getComponent(leaf!, InheritedVisibility)?.visible).toBe(false);
  });
});
