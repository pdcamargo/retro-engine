import { App } from '@retro-engine/engine';
import { createWebGPURenderer } from '@retro-engine/renderer-webgpu';

import { LoggingPlugin } from './logging-plugin';
import { trianglePlugin } from './triangle-plugin';

const canvas = document.getElementById('playground-canvas');
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('playground: #playground-canvas missing or not a <canvas>');
}

const renderer = createWebGPURenderer(canvas);
const app = new App({ renderer, canvas });
app.addPlugin(new LoggingPlugin());
app.addPlugin(trianglePlugin);

app.run().catch((err: unknown) => {
  console.error('[playground] failed to run', err);
});
