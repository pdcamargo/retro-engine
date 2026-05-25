import { App } from '@retro-engine/engine';
import { createWebGPURenderer } from '@retro-engine/renderer-webgpu';

import { atlasShowcasePlugin } from './atlas-showcase-plugin';
import { LoggingPlugin } from './logging-plugin';
import { primitivesShowcasePlugin } from './primitives-showcase-plugin';
import { spriteShowcasePlugin } from './sprite-showcase-plugin';

const canvas = document.getElementById('playground-canvas');
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('playground: #playground-canvas missing or not a <canvas>');
}

// Mode switch:
//   `?mode=atlas`   → Phase 8.2 texture-atlas showcase (ADR-0032).
//   `?mode=sprites` → Phase 8.1 sprite pipeline showcase (ADR-0031).
//   anything else   → Phase 7.5 primitives demo.
// Both demos stay discoverable from one bundle.
const mode = new URLSearchParams(window.location.search).get('mode');
const showcase =
  mode === 'atlas'
    ? atlasShowcasePlugin
    : mode === 'sprites'
      ? spriteShowcasePlugin
      : primitivesShowcasePlugin;

const renderer = createWebGPURenderer(canvas);
const app = new App({
  renderer,
  canvas,
  clearColor: { r: 0.08, g: 0.09, b: 0.12, a: 1 },
});
app.addPlugin(new LoggingPlugin());
app.addPlugin(showcase);

app.run().catch((err: unknown) => {
  console.error('[playground] failed to run', err);
});
