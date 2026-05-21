/// <reference types="@webgpu/types" />

import { App } from '@retro-engine/engine';
import { createWebGPURenderer } from '@retro-engine/renderer-webgpu';

const canvas = document.getElementById('studio-canvas');
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('studio: #studio-canvas missing or not a <canvas>');
}

const dpr = window.devicePixelRatio || 1;
canvas.width = canvas.clientWidth * dpr;
canvas.height = canvas.clientHeight * dpr;

const renderer = createWebGPURenderer(canvas);
const app = new App({ renderer });

app.addPlugin((a) => {
  a.addSystem('startup', () => {
    console.log('[studio] startup');
  });
});

app.run().catch((err: unknown) => {
  console.error('[studio] failed to run', err);
});
