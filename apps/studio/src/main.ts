/// <reference types="@webgpu/types" />

import { App } from '@retro-engine/engine';
import {
  createEditor,
  type FontSpec,
  isDockingEnabled,
  saveLayout,
  ui,
  uiOverlayPlugin,
  widgets,
} from '@retro-engine/editor-sdk';
import { createImGuiOverlay, createWebGPURenderer } from '@retro-engine/renderer-webgpu';

import { drawDialogs, menus, statusBar, toolbar } from './chrome';
import { assetsPanel, consolePanel, profilerPanel, systemsPanel } from './panels-dock';
import { inspectorPanel } from './panels-inspector';
import { hierarchyPanel } from './panels-left';
import { gamePanel, scenePanel } from './panels-viewport';
import { createScene } from './scene-data';
import { createState } from './state';

const LAYOUT_KEY = 'retro.studio.layout';

const canvas = document.getElementById('studio-canvas');
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('studio: #studio-canvas missing or not a <canvas>');
}

const dpr = window.devicePixelRatio || 1;
canvas.width = canvas.clientWidth * dpr;
canvas.height = canvas.clientHeight * dpr;

const renderer = createWebGPURenderer(canvas);
const app = new App({ renderer, canvas, clearColor: { r: 0.027, g: 0.043, b: 0.039, a: 1 } });

const scene = createScene();
const state = createState(scene);

const editor = createEditor({
  brand: 'RETRO ENGINE',
  branch: () => 'main · level_01.scene',
});

editor
  .addPanel(hierarchyPanel(state))
  .addPanel(scenePanel(state))
  .addPanel(gamePanel(state))
  .addPanel(inspectorPanel(state))
  .addPanel(consolePanel(state))
  .addPanel(assetsPanel(state))
  .addPanel(systemsPanel(state))
  .addPanel(profilerPanel(state))
  .setToolbar(toolbar(state, editor))
  .setStatusBar(statusBar(state));
for (const menu of menus(state)) editor.addMenu(menu);

const fetchFont = async (file: string): Promise<Uint8Array> => {
  const res = await fetch(`/fonts/${file}`);
  return new Uint8Array(await res.arrayBuffer());
};

// Probe for the Playwright fidelity check — docking + panel state without pixels.
interface StudioProbe {
  dockingEnabled: boolean;
  selected: string | null;
  playing: boolean;
}
const probe: StudioProbe = { dockingEnabled: false, selected: null, playing: false };
(window as unknown as { __studioProbe: StudioProbe }).__studioProbe = probe;
// Dev helper: capture the live dock layout to bake as a default.
(window as unknown as { __studioLayout: () => string }).__studioLayout = () => saveLayout();

app.addPlugin(
  uiOverlayPlugin({
    overlay: createImGuiOverlay(renderer, { fontLoader: 'freetype' }),
    canvas,
    docking: true,
    fontSizeBase: 13,
    fonts: async (): Promise<readonly FontSpec[]> => {
      const [jbMono, lucide] = await Promise.all([
        fetchFont('JetBrainsMono-Regular.ttf'),
        fetchFont('lucide.ttf'),
      ]);
      // The brand wordmark is drawn as a crisp pixel font (the bundled FreeType
      // build anti-aliases pixel faces), so no Silkscreen face is loaded.
      return [
        { name: 'ui', data: jbMono, sizePixels: 16, default: true },
        { name: 'icons', data: lucide, sizePixels: 16 },
      ];
    },
    layout: {
      default: editor.defaultLayout(),
      restore: () => localStorage.getItem(LAYOUT_KEY),
      persist: (ini) => localStorage.setItem(LAYOUT_KEY, ini),
    },
    draw: (): void => {
      editor.draw();
      drawDialogs({ ui, widgets }, state);
      probe.dockingEnabled = isDockingEnabled();
      probe.selected = state.selected;
      probe.playing = state.playing;
    },
  }),
);

app.run().catch((err: unknown) => {
  console.error('[studio] failed to run', err);
});
