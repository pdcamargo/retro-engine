import { App } from '@retro-engine/engine';
import { createWebGPURenderer } from '@retro-engine/renderer-webgpu';

import { LoggingPlugin } from './logging-plugin';
import { primitivesShowcasePlugin } from './primitives-showcase-plugin';
import { spriteShowcasePlugin } from './sprite-showcase-plugin';

const canvas = document.getElementById('playground-canvas');
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('playground: #playground-canvas missing or not a <canvas>');
}

// Mode switch — `?mode=sprites` runs the Phase 8.1 sprite showcase, anything
// else (including no query) runs the Phase 7.5 primitives demo. Matches the
// `--example`-style ergonomic so both demos stay discoverable from one bundle.
const mode = new URLSearchParams(window.location.search).get('mode');
const showcase = mode === 'sprites' ? spriteShowcasePlugin : primitivesShowcasePlugin;

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
