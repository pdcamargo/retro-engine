import { type Plugin, type App } from '@retro-engine/engine';
import {
  isDockingEnabled,
  loadLayout,
  saveLayout,
  uiOverlayPlugin,
  type Rgb,
  type Ui,
} from '@retro-engine/editor-sdk';
import { createImGuiOverlay } from '@retro-engine/renderer-webgpu/imgui';

import { DEFAULT_IMGUI_LAYOUT } from './imgui-default-layout';

const LAYOUT_KEY = 'retro.playground.imgui.layout';

// ImGui proving ground (?mode=imgui): initialize the editor-sdk UI overlay over
// the playground's WebGPU canvas and draw a dockable, editor-style layout each
// frame through the normalized `ui` wrapper — never raw jsimgui. Validates the
// full path end to end: backend overlay chosen from the active renderer, docking
// enabled, themed by tokens, drawn after the engine's render.
//
// For testability the showcase publishes live docking state to
// `window.__imguiProbe` so a Playwright check can assert docking is on and the
// panels are docked, without depending on pixel positions.
interface ImGuiProbe {
  dockingEnabled: boolean;
  hierarchyDocked: boolean;
  inspectorDocked: boolean;
  clicks: number;
  hierarchyMouseLocal: [number, number];
  mouseScreen: [number, number];
  hierarchyWindowPos: [number, number];
}

export const imguiShowcasePlugin: Plugin = (app: App): void => {
  const canvas = document.getElementById('playground-canvas');
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('imgui showcase: #playground-canvas missing or not a <canvas>');
  }

  const overlay = createImGuiOverlay(app.renderer);

  const state: { enabled: boolean; slider: number; drag: number; accent: Rgb; clicks: number } = {
    enabled: true,
    slider: 0.5,
    drag: 1,
    accent: [0.26, 0.46, 0.72],
    clicks: 0,
  };
  const probe: ImGuiProbe = {
    dockingEnabled: false,
    hierarchyDocked: false,
    inspectorDocked: false,
    clicks: 0,
    hierarchyMouseLocal: [0, 0],
    mouseScreen: [0, 0],
    hierarchyWindowPos: [0, 0],
  };
  (window as unknown as { __imguiProbe: ImGuiProbe }).__imguiProbe = probe;
  // Dev helpers (playground only): capture the current layout to bake as the
  // default, and reset the persisted layout.
  const w = window as unknown as {
    __imguiSaveLayout: () => string;
    __imguiLoadLayout: (ini: string) => void;
    __imguiResetLayout: () => void;
  };
  w.__imguiSaveLayout = (): string => saveLayout();
  w.__imguiLoadLayout = (ini: string): void => loadLayout(ini);
  w.__imguiResetLayout = (): void => localStorage.removeItem(LAYOUT_KEY);

  const fetchFont = async (file: string): Promise<Uint8Array> => {
    const res = await fetch(`/fonts/${file}`);
    return new Uint8Array(await res.arrayBuffer());
  };

  app.addPlugin(
    uiOverlayPlugin({
      overlay,
      canvas,
      docking: true,
      fontSizeBase: 13, // design-system default editor UI size
      fonts: async () => {
        const [jbMono, silkscreen, grotesk] = await Promise.all([
          fetchFont('JetBrainsMono-Regular.ttf'),
          fetchFont('Silkscreen-Regular.ttf'),
          fetchFont('SpaceGrotesk-Regular.ttf'),
        ]);
        return [
          { name: 'ui', data: jbMono, sizePixels: 16, default: true },
          { name: 'pixel', data: silkscreen, sizePixels: 16 },
          { name: 'sans', data: grotesk, sizePixels: 16 },
        ];
      },
      layout: {
        default: DEFAULT_IMGUI_LAYOUT,
        restore: () => localStorage.getItem(LAYOUT_KEY),
        persist: (ini) => localStorage.setItem(LAYOUT_KEY, ini),
      },
      draw: (ui: Ui): void => {
        // Host dockspace; its empty center is transparent so the engine shows through.
        const dock = ui.dockSpaceOverViewport();
        probe.dockingEnabled = isDockingEnabled();

        ui.window({ title: 'Hierarchy', dock }, () => {
          probe.hierarchyDocked = ui.isWindowDocked();
          ui.withFont('pixel', 16, () => ui.text('SCENE')); // Silkscreen pixel heading
          ui.separator();
          ui.text('- Camera');
          ui.text('- Sun');
          ui.text('- Cube');
          ui.text('- Cube (1)');
          ui.separator();
          // Mouse position local to this panel — (0,0) at the panel's top-left.
          const local = ui.windowMousePos();
          const screen = ui.mousePos();
          const winPos = ui.windowPos();
          probe.hierarchyMouseLocal = [local[0], local[1]];
          probe.mouseScreen = [screen[0], screen[1]];
          probe.hierarchyWindowPos = [winPos[0], winPos[1]];
          ui.text(`mouse (panel): ${local[0].toFixed(0)}, ${local[1].toFixed(0)}`);
        });

        ui.window({ title: 'Inspector', dock }, () => {
          probe.inspectorDocked = ui.isWindowDocked();
          ui.text('ImGui overlay through the editor-sdk wrapper.');
          ui.textDisabled('?mode=imgui  -  docking on');
          ui.separator();
          if (ui.button('Click me')) {
            state.clicks += 1;
            probe.clicks = state.clicks;
          }
          ui.sameLine();
          ui.text(`clicks: ${state.clicks}`);
          ui.spacing();
          state.enabled = ui.checkbox('Enabled', state.enabled);
          state.slider = ui.sliderFloat('Slider', state.slider, 0, 1);
          state.drag = ui.dragFloat('Drag', state.drag, { speed: 0.1 });
          state.accent = ui.colorEdit3('Accent', state.accent);
        });

        // A floating, dockable window — drag its title bar onto a panel to dock it.
        ui.window({ title: 'Console', pos: [680, 420], size: [320, 160] }, () => {
          ui.textDisabled('floating — drag me onto a panel to dock');
          ui.text('[info] engine running');
          ui.text(`[info] clicks so far: ${state.clicks}`);
        });

        ui.demoWindow();
      },
    }),
  );
};
