// Motion-blur per-frame dispatch cost (Phase 12.10).
//
// Motion blur is on the per-frame chain: one fullscreen-triangle draw per
// eligible camera, plus a per-frame extract entry, a cached output-target
// lookup, a cached bind-group lookup, and one params-uniform write. This bench
// compares two App configurations of equal scene complexity (an HDR camera
// with the Depth + MotionVector prepass over a handful of PBR meshes) with only
// the `MotionBlur` component toggled — `off` runs the prepass + tonemap chain
// with no blur pass, `on` adds the motion-blur pass. The delta is the per-frame
// CPU cost of the motion-blur dispatch above the prepass+tonemap baseline.
//
// The N-tap fragment loop is GPU-side and invisible to mitata; this measures
// only the CPU dispatch, which is fixed-cost and does not scale with scene
// content.
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
  MotionBlur,
  MotionVectorPrepass,
  NormalPrepass,
  PrepassPlugin,
  StandardMaterial,
  StandardMaterialPlugin,
} from '../src';

import { makeRenderingBenchRenderer, makeStubBenchCanvas, silentLogger } from './helpers';

// The shared rendering bench renderer throws from writeTexture; the engine's
// ImagePlugin uploads its default WHITE image, so add a no-op writeTexture.
const benchRenderer = (): Renderer => ({
  ...makeRenderingBenchRenderer(),
  writeTexture: () => undefined,
});

const MESHES = 16;

const buildApp = async (motionBlur: boolean): Promise<App> => {
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
    new NormalPrepass(),
    new MotionVectorPrepass(),
    ...(motionBlur ? [new MotionBlur()] : []),
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
  bench('App.advanceFrame — HDR + prepass, motion blur OFF (baseline)', () => {
    off.advanceFrame(nextFrame());
  });
  bench('App.advanceFrame — HDR + prepass, motion blur ON', () => {
    on.advanceFrame(nextFrame());
  });
});
