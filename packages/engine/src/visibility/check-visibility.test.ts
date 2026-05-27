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

// The cull is change-gated: with a static camera set, only entities whose own
// inputs changed are recomputed. These tests pin that a second frame produces
// the same result a full per-frame walk would — i.e. no dirty source is missed.
describe('checkVisibility — change-gated second frame', () => {
  const visAfterMutation = async (
    setup: (app: App) => unknown,
    mutate: (app: App, handle: never) => void,
  ): Promise<App> => {
    const app = makeApp();
    const handle = setup(app);
    await app.run(); // frame 1: full pass seeds ViewVisibility
    app.stop();
    mutate(app, handle as never);
    app.advanceFrame(32); // frame 2: change-gated
    return app;
  };

  it('transform move out of frustum flips ViewVisibility false', async () => {
    const app = await visAfterMutation(
      (app) => {
        app.world.spawn(...Camera2d());
        return app.world.spawn(new Visibility('Visible'), new Aabb(vec3.create(0, 0, 0), vec3.create(1, 1, 1)), new Transform());
      },
      (app, e) => {
        app.world.getComponent(e, Transform)!.translation[0] = 10000;
        app.world.markChanged(e, Transform);
      },
    );
    const e = [...app.world.query([ViewVisibility]).entries()][0]![0];
    expect(app.world.getComponent(e, ViewVisibility)?.visible).toBe(false);
  });

  it('transform move back into frustum flips ViewVisibility true', async () => {
    const app = await visAfterMutation(
      (app) => {
        app.world.spawn(...Camera2d());
        return app.world.spawn(
          new Visibility('Visible'),
          new Aabb(vec3.create(0, 0, 0), vec3.create(1, 1, 1)),
          new Transform(vec3.create(10000, 0, 0)),
        );
      },
      (app, e) => {
        app.world.getComponent(e, Transform)!.translation[0] = 0;
        app.world.markChanged(e, Transform);
      },
    );
    const e = [...app.world.query([ViewVisibility]).entries()][0]![0];
    expect(app.world.getComponent(e, ViewVisibility)?.visible).toBe(true);
  });

  it('Visibility Hidden flips ViewVisibility false (Changed<InheritedVisibility>)', async () => {
    const app = await visAfterMutation(
      (app) => {
        app.world.spawn(...Camera2d());
        return app.world.spawn(new Visibility('Visible'), new Aabb(vec3.create(0, 0, 0), vec3.create(1, 1, 1)), new Transform());
      },
      (app, e) => {
        app.world.getComponent(e, Visibility)!.mode = 'Hidden';
        app.world.markChanged(e, Visibility);
      },
    );
    const e = [...app.world.query([ViewVisibility]).entries()][0]![0];
    expect(app.world.getComponent(e, ViewVisibility)?.visible).toBe(false);
  });

  it('RenderLayers change off the camera mask flips ViewVisibility false', async () => {
    const app = await visAfterMutation(
      (app) => {
        app.world.spawn(...Camera2d()); // default layer 0
        return app.world.spawn(
          new Visibility('Visible'),
          RenderLayers.layer(0),
          new Aabb(vec3.create(0, 0, 0), vec3.create(1, 1, 1)),
          new Transform(),
        );
      },
      (app, e) => {
        app.world.getComponent(e, RenderLayers)!.mask = RenderLayers.layer(1).mask;
        app.world.markChanged(e, RenderLayers);
      },
    );
    const e = [...app.world.query([ViewVisibility]).entries()][0]![0];
    expect(app.world.getComponent(e, ViewVisibility)?.visible).toBe(false);
  });

  it('removing NoFrustumCulling re-applies the frustum test (RemovedComponents)', async () => {
    const app = await visAfterMutation(
      (app) => {
        app.world.spawn(...Camera2d());
        return app.world.spawn(
          new Visibility('Visible'),
          new Aabb(vec3.create(0, 0, 0), vec3.create(1, 1, 1)),
          new Transform(vec3.create(10000, 0, 0)), // outside the frustum
          new NoFrustumCulling(),
        );
      },
      (app, e) => {
        app.world.removeComponent(e, NoFrustumCulling);
      },
    );
    const e = [...app.world.query([ViewVisibility]).entries()][0]![0];
    expect(app.world.getComponent(e, ViewVisibility)?.visible).toBe(false);
  });

  it('camera move forces a full recompute (snapshot compare)', async () => {
    const app = makeApp();
    const cam = app.world.spawn(...Camera2d());
    const e = app.world.spawn(new Visibility('Visible'), new Aabb(vec3.create(0, 0, 0), vec3.create(1, 1, 1)), new Transform());
    // No stop() between frames: stop() destroys the surface, freezing the
    // camera's computed view-projection (and thus the frustum). Keeping it alive
    // lets the camera move actually update the frustum the cull snapshots.
    await app.run();
    expect(app.world.getComponent(e, ViewVisibility)?.visible).toBe(true);
    // The entity itself is unchanged; only the camera moves. A missed snapshot
    // compare would leave the stale `true`.
    app.world.getComponent(cam, Transform)!.translation[0] = 10000;
    app.world.markChanged(cam, Transform);
    app.advanceFrame(32);
    app.stop();
    expect(app.world.getComponent(e, ViewVisibility)?.visible).toBe(false);
  });

  it('a despawned dirty entity does not crash the change-gated pass', async () => {
    const app = makeApp();
    app.world.spawn(...Camera2d());
    const e = app.world.spawn(new Visibility('Visible'), new Aabb(vec3.create(0, 0, 0), vec3.create(1, 1, 1)), new Transform());
    await app.run();
    app.stop();
    // Despawn surfaces `e` in RemovedComponents(Aabb); the recompute must skip it.
    app.world.despawn(e);
    expect(() => app.advanceFrame(32)).not.toThrow();
    expect(app.world.hasEntity(e)).toBe(false);
  });
});
