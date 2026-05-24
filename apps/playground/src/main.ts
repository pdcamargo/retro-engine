import { App } from '@retro-engine/engine';
import { createWebGPURenderer } from '@retro-engine/renderer-webgpu';

import { LoggingPlugin } from './logging-plugin';
import { primitivesShowcasePlugin } from './primitives-showcase-plugin';

const canvas = document.getElementById('playground-canvas');
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('playground: #playground-canvas missing or not a <canvas>');
}

const renderer = createWebGPURenderer(canvas);
const app = new App({
  renderer,
  canvas,
  clearColor: { r: 0.08, g: 0.09, b: 0.12, a: 1 },
});
app.addPlugin(new LoggingPlugin());
app.addPlugin(primitivesShowcasePlugin);

app.run().catch((err: unknown) => {
  console.error('[playground] failed to run', err);
});
