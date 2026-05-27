// Event-driven visibility cull + retained prepare — steady-state (0% dirty)
// frame cost vs the legacy full-repack path, across entity counts. See
// docs/adr/ADR-0040.
//
// The legacy path (`retained: false`) re-collects, re-sorts, and re-packs every
// visible instance each frame — O(n). The event-driven retained path
// (`retained: true`) maintains slots and sorted draw order from change events,
// so a static-but-visible scene does O(0) prepare work. The cull is change-gated
// in both modes (its full-pass branch runs only on a camera change), so the
// delta between the two series isolates the prepare's walk-vs-events cost while
// the absolute event-driven number is the residual static-frame floor.
//
// This drives a full `App.advanceFrame` (cull in postUpdate + prepare in the
// render stage) against an inert renderer — buffer uploads are no-ops, so the
// measurement is the CPU repack/membership work, not GPU traffic.

import { bench, summary } from 'mitata';

import { vec2, vec3, vec4 } from '@retro-engine/math';
import type { Renderer } from '@retro-engine/renderer-core';

import { App, Camera2d, Camera3d, Cuboid, Mesh3d, Meshes, NoFrustumCulling, Sprite, Transform } from '../src/index';
import { MaterialPlugin } from '../src/material/material-plugin';
import { UnlitMaterial, UnlitMaterialPlugin } from '../src/material/unlit-material';
import { SpritePlugin } from '../src/sprite/sprite-plugin';

import { makeRenderingBenchRenderer, makeStubBenchCanvas, silentLogger } from './helpers';

const COUNTS = [1_000, 8_000] as const;

// A monotonic clock so each frame advances time without mutating the scene.
let clock = 1_000;
const nextFrame = (): number => (clock += 16);

// The shared rendering bench renderer throws from writeTexture; the sprite path
// uploads the default white image, so add a no-op upload for this bench.
const benchRenderer = (): Renderer => ({ ...makeRenderingBenchRenderer(), writeTexture: () => undefined });

const buildSpriteApp = async (count: number, retained: boolean): Promise<App> => {
  const app = new App({
    renderer: benchRenderer(),
    canvas: makeStubBenchCanvas(),
    logger: silentLogger,
  });
  app.addPlugin(new SpritePlugin({ retained }));
  for (let i = 0; i < count; i++) {
    // Spread within the 640×480 ortho frustum so every sprite is visible.
    const x = (i % 80) * 4 - 158;
    const y = (Math.floor(i / 80) % 60) * 4 - 118;
    app.world.spawn(
      new Sprite({ color: vec4.create(1, 1, 1, 1), customSize: vec2.create(4, 4) }),
      new Transform(vec3.create(x, y, i % 16)),
    );
  }
  app.world.spawn(...Camera2d());
  await app.run(); // frame 1 seeds slots + sorted order
  return app;
};

const buildMeshApp = async (count: number, retained: boolean): Promise<App> => {
  const app = new App({
    renderer: benchRenderer(),
    canvas: makeStubBenchCanvas(),
    logger: silentLogger,
  });
  app.addPlugin(new UnlitMaterialPlugin());
  const plugin = new MaterialPlugin(UnlitMaterial, retained ? { retained: true } : undefined);
  app.addPlugin(plugin);
  const mesh = app.getResource(Meshes)!.add(new Cuboid().mesh().build());
  const material = app.getResource(plugin.Materials)!.add(new UnlitMaterial({ color: vec4.create(1, 1, 1, 1) }));
  for (let i = 0; i < count; i++) {
    app.world.spawn(new Mesh3d(mesh), new plugin.MeshMaterial3d(material), new NoFrustumCulling());
  }
  app.world.spawn(...Camera3d());
  await app.run();
  return app;
};

for (const count of COUNTS) {
  const legacy = await buildSpriteApp(count, false);
  const eventDriven = await buildSpriteApp(count, true);
  summary(() => {
    bench(`sprite static frame: legacy walk @ ${count}`, () => {
      legacy.advanceFrame(nextFrame());
    });
    bench(`sprite static frame: event-driven @ ${count}`, () => {
      eventDriven.advanceFrame(nextFrame());
    });
  });
}

for (const count of COUNTS) {
  const legacy = await buildMeshApp(count, false);
  const eventDriven = await buildMeshApp(count, true);
  summary(() => {
    bench(`mesh static frame: legacy walk @ ${count}`, () => {
      legacy.advanceFrame(nextFrame());
    });
    bench(`mesh static frame: event-driven @ ${count}`, () => {
      eventDriven.advanceFrame(nextFrame());
    });
  });
}
