import { type Plugin, type App } from '@retro-engine/engine';
import {
  isDockingEnabled,
  loadLayout,
  saveLayout,
  uiOverlayPlugin,
  type Rgb,
  type Ui,
} from '@retro-engine/editor-sdk';
import { createImGuiOverlay } from '@retro-engine/renderer-webgpu';

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

  app.addPlugin(
    uiOverlayPlugin({
      overlay,
      canvas,
      docking: true,
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
          ui.text('Scene');
          ui.separator();
          ui.text('- Camera');
          ui.text('- Sun');
          ui.text('- Cube');
          ui.text('- Cube (1)');
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
