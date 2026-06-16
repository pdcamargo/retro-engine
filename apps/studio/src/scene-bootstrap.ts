import {
  type App,
  AmbientLight,
  Camera,
  Camera2d,
  Camera3d,
  CameraRenderTarget,
  ClearColorConfig,
  Commands,
  DepthPrepass,
  GridPlugin,
  Light3dPlugin,
  MaterialPlugin,
  MotionVectorPrepass,
  Name,
  PrepassPlugin,
  Query,
  StandardMaterial,
  StandardMaterialPlugin,
  Taa,
} from '@retro-engine/engine';
import { vec3 } from '@retro-engine/math';
import { type Renderer } from '@retro-engine/renderer-core';

import { defaultEditorTransform, lookFrom, spawnEditorCamera } from './editor-camera';
import { EditorOnly } from './editor-markers';
import { type ViewportTarget } from './viewport';

/**
 * Register the rendering plugins, insert ambient light, and stand up the editor
 * cameras. The editor camera (Scene tab) and the swapchain-clear camera are
 * editor infrastructure, tagged `EditorOnly` so the hierarchy hides them; the
 * game "Main Camera" (Game tab) is authored content the user controls, so it
 * stays visible (and named). The sun and the rest of the authored scene are
 * loaded through the SceneSource (see `installShowcaseScene`).
 */
export const setupViewportScene = (
  app: App,
  renderer: Renderer,
  editorView: ViewportTarget,
  gameView: ViewportTarget,
  stdMat: MaterialPlugin<StandardMaterial>,
): void => {
  app
    .addPlugin(new PrepassPlugin())
    .addPlugin(new StandardMaterialPlugin())
    .addPlugin(stdMat)
    .addPlugin(new Light3dPlugin())
    // Editor-only ground grid; opt-in (not auto-installed), and gated to the
    // editor camera's render layer so it never shows in the Game tab.
    .addPlugin(new GridPlugin());

  app.insertResource(new AmbientLight({ color: vec3.create(0.6, 0.68, 0.82), brightness: 0.12 }));

  app.addSystem(
    'startup',
    [Commands],
    (cmd) => {
      editorView.init(renderer);
      gameView.init(renderer);

      // Editor camera → Scene tab. Spawned in perspective; the view toggle
      // swaps its projection to orthographic on demand. The controller drives
      // navigation; this just stands up the initial camera framing the scene.
      // (Tagged EditorOnly inside spawnEditorCamera.)
      spawnEditorCamera(cmd, editorView.texture!, defaultEditorTransform());

      // Game camera → Game tab. The scene's "Main Camera" — authored content the
      // user controls, so it shows in the hierarchy (not tagged EditorOnly).
      // Renders every frame regardless of play state; Play will later gate
      // simulation systems, never this render.
      cmd.spawn(
        ...Camera3d({
          hdr: true,
          order: 1,
          target: CameraRenderTarget.texture(gameView.texture!),
          clearColor: ClearColorConfig.custom({ r: 0.06, g: 0.07, b: 0.09, a: 1 }),
          transform: lookFrom(vec3.create(0, 1.7, 6.5), vec3.create(0, 0.8, 0)),
        }),
        new DepthPrepass(),
        new MotionVectorPrepass(),
        new Taa(),
        new Name('Main Camera'),
      );

      // Clear-only primary camera: nothing else targets the swapchain, so this
      // opens the one pass that clears it before the ImGui overlay composites
      // (the overlay loads, not clears). Without it the dock gaps show garbage.
      cmd.spawn(
        ...Camera2d({
          order: -100,
          clearColor: ClearColorConfig.custom({ r: 0.027, g: 0.043, b: 0.039, a: 1 }),
        }),
        new EditorOnly(),
      );
    },
  );

  // On a panel resize the viewport reallocates its texture; re-point whichever
  // camera was rendering into it at the new one — matched by the texture the
  // camera still holds, so the game camera needs no editor-owned marker. The
  // camera plugin re-reads `target` each frame, so the swap takes effect next
  // frame.
  const views = [editorView, gameView];
  app.addSystem('update', [Query([Camera])], (q) => {
    for (const view of views) {
      const stale = view.takeStale();
      if (stale === null || view.texture === null) continue;
      const next = CameraRenderTarget.texture(view.texture);
      for (const row of q.entries()) {
        const camera = row[1] as Camera;
        if (camera.target.kind === 'texture' && camera.target.texture === stale) {
          camera.target = next;
        }
      }
    }
  });
};
