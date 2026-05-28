// Tonemapping per-frame cost (ADR-0048):
//
// The tonemap pass is on the per-frame chain: one fullscreen-triangle draw
// per HDR camera per frame. The bench compares two App configurations of
// equal scene complexity (single empty Camera3d) with only the `hdr`
// boolean toggled — `hdr: false` skips the tonemap pass entirely, `hdr:
// true` allocates the rgba16float intermediate and runs one tonemap pass
// with the default operator (AgX). The delta is the per-frame cost of HDR
// + tonemap above the non-HDR baseline; regression here = added per-frame
// overhead for every HDR camera.
//
// See docs/adr/ADR-0017 (bench schema) and docs/adr/ADR-0048 (HDR + tonemap).

import { bench, summary } from 'mitata';

import type { Renderer } from '@retro-engine/renderer-core';

import { App, Camera3d } from '../src';

import { makeRenderingBenchRenderer, makeStubBenchCanvas, silentLogger } from './helpers';

// The shared rendering bench renderer throws from writeTexture; the
// engine's ImagePlugin uploads its default WHITE image, so add a no-op
// writeTexture for this bench (same shape as event-driven-cull-prepare.bench.ts).
const benchRenderer = (): Renderer => ({
  ...makeRenderingBenchRenderer(),
  writeTexture: () => undefined,
});

const buildHdrApp = async (hdr: boolean): Promise<App> => {
  const app = new App({
    renderer: benchRenderer(),
    canvas: makeStubBenchCanvas(),
    logger: silentLogger,
  });
  app.world.spawn(...Camera3d(hdr ? { hdr: true } : {}));
  // One frame so plugin lifecycle reaches `Cleaned` and the graph freezes
  // before the timed loop.
  await app.run();
  app.stop();
  return app;
};

const ldr = await buildHdrApp(false);
const hdr = await buildHdrApp(true);

let frameCounter = 1;
const nextFrame = (): number => (frameCounter++) * 16.666;

summary(() => {
  bench('App.advanceFrame — single Camera3d, hdr: false (baseline)', () => {
    ldr.advanceFrame(nextFrame());
  });
  bench('App.advanceFrame — single Camera3d, hdr: true (AgX tonemap)', () => {
    hdr.advanceFrame(nextFrame());
  });
});
