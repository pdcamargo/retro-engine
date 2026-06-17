/// <reference types="@webgpu/types" />

import { App, AppTypeRegistry, Commands, EditorGrid, MaterialPlugin, ResMut, StandardMaterial } from '@retro-engine/engine';
import {
  buildOutline,
  createEditor,
  type FontSpec,
  History,
  isDockingEnabled,
  listComponents,
  saveLayout,
  ui,
  uiOverlayPlugin,
  widgets,
} from '@retro-engine/editor-sdk';
import { createImGuiOverlay, createWebGPURenderer } from '@retro-engine/renderer-webgpu';

import { drawDialogs, menus, statusBar, toolbar } from './chrome';
import { SceneCameraController } from './editor-camera';
import { EditorOnly } from './editor-markers';
import { studioClassifiers } from './entity-classifiers';
import { SceneGizmos } from './gizmo-wiring';
import { assetsPanel, consolePanel, profilerPanel, systemsPanel } from './panels-dock';
import { inspectorPanel } from './panels-inspector';
import { hierarchyPanel } from './panels-left';
import { gamePanel, scenePanel } from './panels-viewport';
import { createPlatformHost } from './platform/create-platform-host';
import { createScene } from './scene-data';
import { setupViewportScene } from './scene-bootstrap';
import { inMemorySceneSource } from './scene-source';
import { handleHistoryShortcuts } from './shortcuts';
import { installShowcaseScene, SHOWCASE_SCENE } from './showcase-scene';
import { createState } from './state';
import { ViewportTarget } from './viewport';

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

// Editor undo/redo. Binds to the live world + the same reflection registry the
// plugins populate; inspector edits route through it and are undoable.
const history = new History(
  { world: app.world, registry: app.getResource(AppTypeRegistry)!.registry },
  { capacity: 200 },
);

// Offscreen render targets for the Scene (editor) and Game viewports, plus the
// 3D scene and cameras that render into them.
const editorView = new ViewportTarget();
const gameView = new ViewportTarget();
const stdMat = new MaterialPlugin(StandardMaterial);
setupViewportScene(app, renderer, editorView, gameView, stdMat);
const sceneGizmos = new SceneGizmos(app, editorView);
// Emit the gizmo handles before the render graph runs (the UI pass that draws
// the viewport image comes later in the frame, too late to reach the texture).
app.addSystem('postUpdate', [], () => sceneGizmos.tick());

// Editor camera navigation. The controller reads viewport input in the Scene
// panel body (UI pass) and applies it here, before postUpdate recomputes the
// camera matrices.
const sceneCamera = new SceneCameraController(app, editorView);

// Reconcile the toolbar/hotkey view mode with the live camera: on a change,
// swap the editor camera's projection (perspective ↔ orthographic) and point
// the editor grid at the matching plane (XZ ground for 3D, XY work plane for
// 2D). Runs before the controller tick so the new projection is in place when
// the transform is written on the toggle frame.
app.addSystem('update', [Commands, ResMut(EditorGrid)], (cmd, grid) => {
  if (state.viewMode !== sceneCamera.appliedMode) {
    sceneCamera.setMode(cmd, state.viewMode);
    grid.plane = state.viewMode === '2d' ? 'xy' : 'xz';
  }
});

app.addSystem('update', [], () => sceneCamera.tick());

// The toolbar snap toggle is the editor-side source of truth; mirror it into the
// engine's grid config so grid visuals + future snap-to-grid read one object.
app.addSystem('postUpdate', [ResMut(EditorGrid)], (grid) => {
  grid.snapEnabled = state.snap;
  grid.snapStep = state.snapStep;
});

const editor = createEditor({
  brand: 'RETRO ENGINE',
  branch: () => 'main · level_01.scene',
});

// Author Transform rotations as Euler angles (degrees) — friendlier than raw
// quaternion x/y/z/w. Swap to a single 2D angle with `{ widget: 'angle2d' }`, or
// remove this amendment to edit the raw quaternion components.
editor.inspector.amend('Transform', [{ kind: 'field', name: 'rotation' }] as const, { widget: 'euler' });

editor
  .addPanel(hierarchyPanel(state, app))
  .addPanel(scenePanel(state, editorView, sceneGizmos, sceneCamera))
  .addPanel(gamePanel(state, gameView))
  .addPanel(inspectorPanel(state, app, editor.inspector, history))
  .addPanel(consolePanel(state))
  .addPanel(assetsPanel(state))
  .addPanel(systemsPanel(state))
  .addPanel(profilerPanel(state))
  .setToolbar(toolbar(state, editor))
  .setStatusBar(statusBar(state));
for (const menu of menus(state, history)) editor.addMenu(menu);

const fetchFont = async (file: string): Promise<Uint8Array> => {
  const res = await fetch(`/fonts/${file}`);
  return new Uint8Array(await res.arrayBuffer());
};

// Probe for the Playwright fidelity check — docking + panel state without pixels.
interface StudioProbe {
  dockingEnabled: boolean;
  selected: number | null;
  playing: boolean;
  viewMode: string;
  platformKind: 'browser' | 'tauri';
}
const probe: StudioProbe = {
  dockingEnabled: false,
  selected: null,
  playing: false,
  viewMode: '3d',
  platformKind: 'browser',
};
(window as unknown as { __studioProbe: StudioProbe }).__studioProbe = probe;
// Dev helper: capture the live dock layout to bake as a default.
(window as unknown as { __studioLayout: () => string }).__studioLayout = () => saveLayout();
// Dev helper: read the live entity outline + the selected entity's components,
// so the Playwright fidelity check can assert the tree/inspector without pixels.
(window as unknown as { __studioInspect: (sel?: number) => unknown }).__studioInspect = (sel) => {
  const target = typeof sel === 'number' ? sel : state.selectedEntity;
  return {
    selected: state.selectedEntity,
    outline: buildOutline(app.world, {
      classifiers: studioClassifiers,
      registry: state.debugMode ? undefined : app.getResource(AppTypeRegistry)!.registry,
      skip: (e) => !state.debugMode && app.world.has(e, EditorOnly),
    }).map((n) => ({
      entity: n.entity,
      name: n.name,
      depth: n.depth,
      kind: n.class.kind,
      components: n.componentCount,
    })),
    components:
      target !== null && app.world.hasEntity(target as never)
        ? listComponents(app.world, app.getResource(AppTypeRegistry)!.registry, target as never)
        : [],
  };
};

// The platform host (native under Tauri, web in the browser) resolves async, and
// the overlay's layout.restore is synchronous — so pick the host and pre-load the
// saved layout before wiring the overlay, then start the frame loop.
void (async (): Promise<void> => {
  const platform = await createPlatformHost();
  probe.platformKind = platform.kind;
  (window as unknown as { __studioPrefs: typeof platform.preferences }).__studioPrefs = platform.preferences;

  const savedLayout = await platform.preferences.get(LAYOUT_KEY);

  // Opinionated, host-agnostic scene load: today an in-memory showcase, later a
  // browser endpoint or a Tauri file behind the same SceneSource contract.
  const initialScene = await inMemorySceneSource(SHOWCASE_SCENE).load();
  installShowcaseScene(app, { material: stdMat, scene: initialScene });

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
        restore: () => savedLayout,
        persist: (ini) => {
          void platform.preferences.set(LAYOUT_KEY, ini);
        },
      },
      draw: (): void => {
        handleHistoryShortcuts(history);
        editor.draw();
        drawDialogs({ ui, widgets }, state);
        probe.dockingEnabled = isDockingEnabled();
        probe.selected = state.selectedEntity;
        probe.playing = state.playing;
        probe.viewMode = state.viewMode;
      },
    }),
  );

  await app.run();
})().catch((err: unknown) => {
  console.error('[studio] failed to run', err);
});
