// Ambient-occlusion per-frame dispatch cost (ADR-0054).
//
// AO is on the per-frame chain: one fullscreen-triangle GTAO draw per eligible
// camera, plus a per-frame extract entry, a cached target lookup, a CPU
// jittered-inverse-projection (one mat4 invert), one params-uniform write, and
// the @group(3) read bind-group resolve. This bench compares two App configs of
// equal scene complexity (a camera with the Depth + Normal prepass over a
// handful of PBR meshes) with only the `ScreenSpaceAo` component toggled —
// `off` runs the prepass chain with no AO pass, `on` adds the AO pass and the
// AO-enabled opaque pipeline variant. The delta is the per-frame CPU cost of the
// AO dispatch above the prepass baseline.
//
// The horizon-search fragment loop is GPU-side and invisible to mitata; this
// measures only the fixed-cost CPU dispatch (including the per-camera matrix
// inverse), which does not scale with scene content.
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
  NormalPrepass,
  PrepassPlugin,
  ScreenSpaceAo,
  StandardMaterial,
  StandardMaterialPlugin,
} from '../src';

import { makeRenderingBenchRenderer, makeStubBenchCanvas, silentLogger } from './helpers';

const benchRenderer = (): Renderer => ({
  ...makeRenderingBenchRenderer(),
  writeTexture: () => undefined,
});

const MESHES = 16;

const buildApp = async (ao: boolean): Promise<App> => {
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
    ...(ao ? [new ScreenSpaceAo()] : []),
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
  bench('App.advanceFrame — prepass, AO OFF (baseline)', () => {
    off.advanceFrame(nextFrame());
  });
  bench('App.advanceFrame — prepass, AO ON', () => {
    on.advanceFrame(nextFrame());
  });
});
