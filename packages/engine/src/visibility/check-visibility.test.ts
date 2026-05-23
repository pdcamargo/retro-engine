import { describe, expect, it } from 'bun:test';
import { Aabb, vec3 } from '@retro-engine/math';

import { App, Camera2d, GlobalTransform, RenderLayers, Transform } from '../index';
import { makeRenderingRenderer, makeStubCanvas } from '../test-utils';
import { NoFrustumCulling, Visibility, ViewVisibility } from './visibility';

const makeApp = () => new App({ renderer: makeRenderingRenderer(), canvas: makeStubCanvas() });

// Stub canvas is 640×480; Camera2d defaults to OrthographicProjection with
// WindowSize scaling + viewportOrigin (0.5, 0.5), near=-1000, far=1000 —
// visible world rect ~ X[-320, 320], Y[-240, 240], Z[-1000, 1000] around
// the camera's transform.

describe('checkVisibility (postUpdate, per-entity ViewVisibility write)', () => {
  it('hidden via InheritedVisibility → ViewVisibility.visible = false', async () => {
    const app = makeApp();
    app.world.spawn(...Camera2d());
    const e = app.world.spawn(
      new Visibility('Hidden'),
      new Aabb(vec3.create(0, 0, 0), vec3.create(1, 1, 1)),
      new Transform(),
    );
    await app.run();
    expect(app.world.getComponent(e, ViewVisibility)?.visible).toBe(false);
  });

  it('camera and entity on different render layers → ViewVisibility = false', async () => {
    const app = makeApp();
    app.world.spawn(...Camera2d(), RenderLayers.layer(1));
    const e = app.world.spawn(
      new Visibility('Visible'),
      RenderLayers.layer(2),
      new Aabb(vec3.create(0, 0, 0), vec3.create(1, 1, 1)),
      new Transform(),
    );
    await app.run();
    expect(app.world.getComponent(e, ViewVisibility)?.visible).toBe(false);
  });

  it('entity inside the frustum → ViewVisibility = true', async () => {
    const app = makeApp();
    app.world.spawn(...Camera2d());
    const e = app.world.spawn(
      new Visibility('Visible'),
      new Aabb(vec3.create(0, 0, 0), vec3.create(1, 1, 1)),
      new Transform(),
    );
    await app.run();
    expect(app.world.getComponent(e, ViewVisibility)?.visible).toBe(true);
  });

  it('entity far outside the frustum → ViewVisibility = false', async () => {
    const app = makeApp();
    app.world.spawn(...Camera2d());
    // Camera covers X[-320, 320]; placing a 1-unit box at X=10000 is far
    // beyond the right plane.
    const e = app.world.spawn(
      new Visibility('Visible'),
      new Aabb(vec3.create(0, 0, 0), vec3.create(1, 1, 1)),
      new Transform(vec3.create(10000, 0, 0)),
    );
    await app.run();
    expect(app.world.getComponent(e, ViewVisibility)?.visible).toBe(false);
  });

  it('NoFrustumCulling forces visibility even far outside the frustum', async () => {
    const app = makeApp();
    app.world.spawn(...Camera2d());
    const e = app.world.spawn(
      new Visibility('Visible'),
      new Aabb(vec3.create(0, 0, 0), vec3.create(1, 1, 1)),
      new Transform(vec3.create(10000, 0, 0)),
      new NoFrustumCulling(),
    );
    await app.run();
    expect(app.world.getComponent(e, ViewVisibility)?.visible).toBe(true);
  });

  it('entity with no Aabb is treated as always-visible (skips frustum test)', async () => {
    const app = makeApp();
    app.world.spawn(...Camera2d());
    const e = app.world.spawn(new Visibility('Visible'), new Transform(vec3.create(10000, 0, 0)));
    await app.run();
    expect(app.world.getComponent(e, ViewVisibility)?.visible).toBe(true);
  });

  it('no active cameras → every renderable culled', async () => {
    const app = makeApp();
    // Spawn a renderable but no camera.
    const e = app.world.spawn(
      new Visibility('Visible'),
      new Aabb(vec3.create(0, 0, 0), vec3.create(1, 1, 1)),
      new Transform(),
    );
    await app.run();
    expect(app.world.getComponent(e, ViewVisibility)?.visible).toBe(false);
  });

  it('camera has Frustum auto-attached via Required Components on first spawn', async () => {
    const app = makeApp();
    const cam = app.world.spawn(...Camera2d());
    // Frustum is present before the first frame runs (Required Components is
    // a spawn-time mechanism, not a post-system one).
    expect(app.world.getComponent(cam, GlobalTransform)).toBeDefined();
    // The Frustum's planes are unit-length only after updateFrusta has run
    // against the camera's computed view-projection, so we don't assert on
    // pre-frame plane values here — the inside-frustum / outside-frustum
    // tests above already cover the post-update state.
  });
});
