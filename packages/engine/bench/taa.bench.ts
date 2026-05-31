// TAA per-frame dispatch cost (Phase 12.6).
//
// The TAA resolve is on the per-frame chain: one fullscreen-triangle draw per
// eligible camera, plus a per-frame extract entry (jitter offset + blend), a
// cached history-target lookup, a ping-pong flip, a params-uniform write, and a
// cached bind-group lookup keyed by the active history slot. This bench compares
// two App configurations of equal scene complexity (an HDR camera with the
// Depth + MotionVector prepass over a handful of PBR meshes) with only the `Taa`
// component toggled — `off` runs the prepass + tonemap chain with no resolve,
// `on` adds the TAA resolve and the per-frame camera jitter it drives. The delta
// is the per-frame CPU cost of TAA above the prepass+tonemap baseline.
//
// The neighborhood-clip + reproject fragment work is GPU-side and invisible to
// mitata; this measures only the CPU dispatch, which is fixed-cost and does not
// scale with scene content.
//
// See docs/adr/ADR-0017 (bench schema).

import { bench, summary } from 'mitata';

import { vec4 } from '@retro-engine/math';
import type { Renderer } from '@retro-engine/renderer-core';

import {
  App,
  Camera3d,
  Cuboid,
  DepthPrepass,
  Light3dPlugin,
  MaterialPlugin,
  Mesh3d,
  Meshes,
  MotionVectorPrepass,
  PrepassPlugin,
  StandardMaterial,
  StandardMaterialPlugin,
  Taa,
} from '../src';

import { makeRenderingBenchRenderer, makeStubBenchCanvas, silentLogger } from './helpers';

// The shared rendering bench renderer throws from writeTexture; the engine's
// ImagePlugin uploads its default WHITE image, so add a no-op writeTexture.
const benchRenderer = (): Renderer => ({
  ...makeRenderingBenchRenderer(),
  writeTexture: () => undefined,
});

const MESHES = 16;

const buildApp = async (taa: boolean): Promise<App> => {
  const app = new App({
    renderer: benchRenderer(),
    canvas: makeStubBenchCanvas(),
    logger: silentLogger,
  });
  app.addPlugin(new StandardMaterialPlugin());
  const pbr = new MaterialPlugin(StandardMaterial);
  app.addPlugin(pbr);
  app.addPlugin(new Light3dPlugin());
  app.addPlugin(new PrepassPlugin());

  const mesh = app.getResource(Meshes)!.add(new Cuboid().mesh().build());
  for (let i = 0; i < MESHES; i++) {
    const mat = app
      .getResource(pbr.Materials)!
      .add(new StandardMaterial({ baseColor: vec4.create(1, 1, 1, 1) }));
    app.world.spawn(new Mesh3d(mesh), new pbr.MeshMaterial3d(mat));
  }
  app.world.spawn(
    ...Camera3d({ hdr: true }),
    new DepthPrepass(),
    new MotionVectorPrepass(),
    ...(taa ? [new Taa()] : []),
  );

  // One frame so plugin lifecycle reaches `Cleaned` and the graph freezes
  // before the timed loop.
  await app.run();
  app.stop();
  return app;
};

const off = await buildApp(false);
const on = await buildApp(true);

let frameCounter = 1;
const nextFrame = (): number => (frameCounter++) * 16.666;

summary(() => {
  bench('App.advanceFrame — HDR + prepass, TAA OFF (baseline)', () => {
    off.advanceFrame(nextFrame());
  });
  bench('App.advanceFrame — HDR + prepass, TAA ON', () => {
    on.advanceFrame(nextFrame());
  });
});
