import type { Entity } from '@retro-engine/ecs';
import { mat4 } from '@retro-engine/math';
import { describe, expect, it } from 'bun:test';

import { App } from '../index';
import { Mesh, Mesh3d, Meshes } from '../mesh';
import { makeRenderingRenderer, makeStubCanvas } from '../test-utils';
import { GlobalTransform, Transform } from '../transform';

import { PreviousGlobalTransform } from './previous-global-transform';
import { PrepassFlagsByCamera, PrepassPlugin } from './prepass-plugin';
import { ViewPrepassTargets } from './view-prepass-targets';

const newApp = (): App => {
  const app = new App({
    renderer: makeRenderingRenderer(),
    canvas: makeStubCanvas(),
  });
  app.addPlugin(new PrepassPlugin());
  return app;
};

describe('PrepassPlugin', () => {
  it('inserts ViewPrepassTargets and PrepassFlagsByCamera resources', () => {
    const app = newApp();
    expect(app.getResource(ViewPrepassTargets)).toBeInstanceOf(ViewPrepassTargets);
    expect(app.getResource(PrepassFlagsByCamera)).toBeInstanceOf(PrepassFlagsByCamera);
  });

  it('is unique — adding it twice throws', () => {
    const app = newApp();
    expect(() => app.addPlugin(new PrepassPlugin())).toThrow(/unique/);
  });
});

describe('previous-transform-propagate system', () => {
  const seededEntity = (app: App, x: number): Entity => {
    const meshes = app.getResource(Meshes)!;
    const meshHandle = meshes.add(new Mesh());
    const transform = new Transform();
    transform.translation[0] = x;
    const gt = new GlobalTransform();
    mat4.translation([x, 0, 0], gt.matrix);
    const prev = new PreviousGlobalTransform();
    return app.world.spawn(transform, gt, new Mesh3d(meshHandle), prev);
  };

  it("copies GlobalTransform → PreviousGlobalTransform during 'first'", () => {
    const app = newApp();
    const e = seededEntity(app, 5);
    // Frame 1: 'first' runs and copies GT to PrevGT (both currently x=5).
    app.advanceFrame(0);
    const prev1 = app.world.getComponent(e, PreviousGlobalTransform)!;
    const gt1 = app.world.getComponent(e, GlobalTransform)!;
    expect(Array.from(prev1.matrix)).toEqual(Array.from(gt1.matrix));
  });

  it('captures the prior frame value when GT mutates between frames', () => {
    const app = newApp();
    const e = seededEntity(app, 10);
    app.advanceFrame(0); // first run: PrevGT = GT (= x=10).

    // Simulate gameplay mutating GT between frames.
    const gt = app.world.getComponent(e, GlobalTransform)!;
    mat4.translation([20, 0, 0], gt.matrix);

    // Frame 2: 'first' captures previous-frame GT value (= the snapshot we
    // just made), then later stages would mutate GT further — for this test
    // we just verify the 'first' snapshot picks up the new gt.matrix value
    // because no other system touches GT in this minimal app.
    app.advanceFrame(16);
    const prev2 = app.world.getComponent(e, PreviousGlobalTransform)!;
    // After 'first', prev = gt (which we set to x=20 above).
    expect(Array.from(prev2.matrix)).toEqual(Array.from(gt.matrix));
  });
});
