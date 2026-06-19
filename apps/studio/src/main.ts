/// <reference types="@webgpu/types" />

import { App, AppTypeRegistry, Commands, EditorGrid, MaterialPlugin, ResMut, StandardMaterial } from '@retro-engine/engine';
import {
  buildOutline,
  createEditor,
  currentSimState,
  type FontSpec,
  History,
  initSimState,
  isDockingEnabled,
  listComponents,
  saveLayout,
  SimState,
  ui,
  uiOverlayPlugin,
  widgets,
} from '@retro-engine/editor-sdk';
import { createImGuiOverlay, createWebGPURenderer } from '@retro-engine/renderer-webgpu';

import { publishHost } from './host-bridge';
import { createProjectBuilder } from './project/project-builder';
import { applyProject, buildEditorExtensions, buildProjectModule } from './project/load-project';
import { currentProjectDir, setCurrentProjectDir } from './project/current-project';
import { buildCodeIndex, captureBaseline, type CodeIndex, parseProjectDescriptor } from './project/project-index';
import { createProjectIo } from './project/project-io';
import { projectStateKey } from './project/project-state';
import { engineVersionMismatch, STUDIO_ENGINE_VERSION } from './project/engine-version';
import { listProjectFiles } from './project/list-files';
import { loadProjectScene, scanProjectManifest } from './project/project-scene';

// Publish the studio's engine packages so built user code resolves to live instances.
publishHost();

import { drawDialogs, menus, statusBar, toolbar } from './chrome';
import { SceneCameraController } from './editor-camera';
import { EditorOnly } from './editor-markers';
import { studioClassifiers } from './entity-classifiers';
import { SceneGizmos } from './gizmo-wiring';
import { assetsPanel, consolePanel, profilerPanel, systemsPanel } from './panels-dock';
import { historyPanel } from './panels-history';
import { inspectorPanel } from './panels-inspector';
import { hierarchyPanel } from './panels-left';
import { gamePanel, scenePanel } from './panels-viewport';
import { createPlatformHost } from './platform/create-platform-host';
import { ScenePicker } from './scene-picker';
import { createScene } from './scene-data';
import { setupViewportScene } from './scene-bootstrap';
import { inMemorySceneSource } from './scene-source';
import { SceneOrientationGizmo } from './viewport-gizmo-wiring';
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
// profileSystems: the studio measures per-system frame cost for the Systems panel.
// defaultSystemOrigin: systems the studio registers directly are editor scaffolding,
// not user game code, so they bucket under "Editor" by default.
const app = new App({
  renderer,
  canvas,
  clearColor: { r: 0.027, g: 0.043, b: 0.039, a: 1 },
  profileSystems: true,
  defaultSystemOrigin: 'editor',
});
// Engine-backed play state (Edit/Play/Paused) the toolbar drives and panels reflect.
initSimState(app);

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
const sceneGizmos = new SceneGizmos(app, editorView, state);
// Click-to-select in the Scene viewport, sharing the editor camera with the gizmo.
const scenePicker = new ScenePicker(app, editorView, state);
// Emit the gizmo handles before the render graph runs (the UI pass that draws
// the viewport image comes later in the frame, too late to reach the texture).
// Pick after the gizmo tick so an in-progress drag (the transform lock) skips it.
app.addSystem('postUpdate', [], () => sceneGizmos.tick(), { name: 'editor-gizmos' });
app.addSystem('postUpdate', [], () => scenePicker.pick(sceneGizmos.isActive()), { name: 'editor-scene-picker' });

// Editor camera navigation. The controller reads viewport input in the Scene
// panel body (UI pass) and applies it here, before postUpdate recomputes the
// camera matrices.
const sceneCamera = new SceneCameraController(app, editorView);

// The viewport orientation gizmo (top-right of the Scene view): reflects the
// editor camera's orientation, drag to orbit, click an axis to align. Draws +
// captures in the Scene panel body; forwards orbit/align to the controller.
const orientationGizmo = new SceneOrientationGizmo(app, editorView, state, sceneCamera);

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
}, { name: 'editor-camera-mode' });

app.addSystem('update', [], () => sceneCamera.tick(), { name: 'editor-camera-tick' });

// The toolbar snap toggle is the editor-side source of truth; mirror it into the
// engine's grid config so grid visuals + future snap-to-grid read one object.
app.addSystem('postUpdate', [ResMut(EditorGrid)], (grid) => {
  grid.snapEnabled = state.snap;
  grid.snapStep = state.snapStep;
}, { name: 'editor-grid-snap' });

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
  .addPanel(scenePanel(state, editorView, sceneGizmos, sceneCamera, scenePicker, orientationGizmo))
  .addPanel(gamePanel(state, gameView))
  .addPanel(inspectorPanel(state, app, editor.inspector, history))
  .addPanel(historyPanel(state, app, history))
  .addPanel(consolePanel(state))
  .addPanel(assetsPanel(state))
  .addPanel(systemsPanel(app))
  .addPanel(profilerPanel(app))
  .setToolbar(toolbar(state, editor, app))
  .setStatusBar(statusBar(state, app));
// Set once the platform host resolves (in the async boot tail); the menu calls through it.
let openProjectAction: () => void = () => {};
for (const menu of menus(state, history, { openProject: () => openProjectAction() })) editor.addMenu(menu);

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
// Dev helper / Playwright probe: build + load a project dir through the host-bridge
// loader and report what came back (meta + plugin names), proving user code resolves
// against the studio's live engine. Applying it to a fresh App is the App-rebuild path.
(window as unknown as { __studioProject: (dir: string) => Promise<unknown> }).__studioProject = async (
  dir: string,
) => {
  const project = await buildProjectModule(createProjectBuilder(), dir);
  return { meta: project.meta ?? null, plugins: project.plugins.map((p) => p.name()) };
};
// Dev helper: capture the live dock layout to bake as a default.
(window as unknown as { __studioLayout: () => string }).__studioLayout = () => saveLayout();
// Dev helper: read the live schedule + play state, so the Playwright fidelity
// check can assert the Systems panel's data (origin buckets, ms, enabled) without pixels.
(window as unknown as { __studioSystems: () => unknown }).__studioSystems = () => ({
  simState: currentSimState(app)?.name ?? null,
  groups: app.describeSchedule().map((g) => ({
    stage: g.stage,
    systems: g.systems.map((s) => ({
      name: s.name,
      origin: s.origin,
      plugin: s.originPlugin,
      enabled: s.enabled,
      avgMs: s.avgMs,
    })),
  })),
});
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

  // Read the open project's descriptor (best-effort) so its dock layout + window
  // state persist per-project (keyed by project id in the app config), not globally.
  const projectDir = await currentProjectDir(platform);
  let descriptor: ReturnType<typeof parseProjectDescriptor> | null = null;
  if (projectDir !== null) {
    try {
      const io = createProjectIo(platform, projectDir);
      descriptor = parseProjectDescriptor(new TextDecoder().decode(await io.source.read('project.retroengine')));
      if (engineVersionMismatch(descriptor.engine, STUDIO_ENGINE_VERSION)) {
        console.warn(
          `[studio] project targets engine ${descriptor.engine}, studio provides ${STUDIO_ENGINE_VERSION} — types may not match`,
        );
      }
    } catch (err) {
      console.error('[studio] could not read project.retroengine', err);
    }
  }
  const projectId = descriptor !== null && descriptor.projectId.length > 0 ? descriptor.projectId : null;
  const layoutKey = projectId !== null ? projectStateKey(projectId, 'layout') : LAYOUT_KEY;
  const savedLayout = await platform.preferences.get(layoutKey);

  // Open project / App-rebuild: opening a project re-launches the studio session
  // (a clean App rebuild). When one is set, build + apply its plugins now — the
  // App is still in its Building phase, so the project's components, systems, and
  // resources register into the live App + AppTypeRegistry the editor reads.
  const baseline = captureBaseline(app);
  let projectCodeIndex: CodeIndex | null = null;
  if (projectDir !== null) {
    try {
      const project = await buildProjectModule(createProjectBuilder(), projectDir);
      applyProject(app, project);
      // Code-derived index: the project's systems/components/resources/editors,
      // beyond the engine + editor baseline captured above.
      projectCodeIndex = buildCodeIndex(app, editor.inspector, baseline);
      console.log(`[studio] loaded project ${projectDir}: ${project.plugins.map((p) => p.name()).join(', ')}`);

      // Editor extensions: a second build artifact, loaded only here (never in a
      // game build), registering custom inspectors into the studio-lifetime registry.
      if (descriptor?.editorEntry != null) {
        try {
          const ext = await buildEditorExtensions(createProjectBuilder(), projectDir, descriptor.editorEntry);
          ext.setup(editor.inspector);
        } catch (err) {
          console.error('[studio] failed to load editor extensions', err);
        }
      }
    } catch (err) {
      console.error(`[studio] failed to load project ${projectDir}`, err);
    }
  }
  (window as unknown as { __studioProjectIndex: () => CodeIndex | null }).__studioProjectIndex = () =>
    projectCodeIndex;
  // Persist a project + reload to (re)build the studio session into it.
  const openProjectInto = async (dir: string): Promise<void> => {
    await setCurrentProjectDir(platform, dir);
    window.location.reload();
  };
  (window as unknown as { __studioOpenProject: (dir: string) => Promise<void> }).__studioOpenProject = openProjectInto;

  // Wire the File ▸ Open Project… menu now that the host is known: native folder
  // dialog under Tauri, a path prompt in a plain browser.
  openProjectAction = (): void => {
    void (async (): Promise<void> => {
      let dir: string | null = null;
      if (platform.openProject !== undefined) {
        dir = await platform.openProject();
      } else {
        dir = window.prompt('Open project — absolute path to the project folder:');
      }
      if (dir !== null && dir.length > 0) await openProjectInto(dir);
    })();
  };

  // Host-agnostic scene load: the open project's startup scene from disk, or the
  // in-memory showcase when no project is open (or its scene can't be resolved).
  let sceneLoaded = false;
  if (projectDir !== null && descriptor?.startupScene != null && descriptor.startupScene.length > 0) {
    try {
      const io = createProjectIo(platform, projectDir);
      const files = await listProjectFiles(platform);
      const manifest = await scanProjectManifest(io.source, files);
      sceneLoaded = await loadProjectScene(app, io.source, manifest, descriptor.startupScene);
      if (sceneLoaded) console.log(`[studio] loaded startup scene ${descriptor.startupScene}`);
      else console.warn(`[studio] startup scene ${descriptor.startupScene} not found in project`);
    } catch (err) {
      console.error('[studio] failed to load project scene', err);
    }
  }
  if (!sceneLoaded) {
    const initialScene = await inMemorySceneSource(SHOWCASE_SCENE).load();
    installShowcaseScene(app, { material: stdMat, scene: initialScene });
  }

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
          void platform.preferences.set(layoutKey, ini);
        },
      },
      draw: (): void => {
        // Mirror the engine's play state into the studio's UI booleans so panels
        // that don't hold the App (viewports, inspector) read one source of truth.
        const sim = currentSimState(app);
        state.playing = sim === SimState.Play || sim === SimState.Paused;
        state.paused = sim === SimState.Paused;
        handleHistoryShortcuts(history);
        editor.draw();
        drawDialogs({ ui, widgets }, state, history);
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
