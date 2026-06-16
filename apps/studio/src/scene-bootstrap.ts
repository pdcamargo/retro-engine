import { type Entity } from '@retro-engine/ecs';
import {
  type App,
  AmbientLight,
  Camera,
  Camera2d,
  CameraRenderTarget,
  ClearColorConfig,
  Commands,
  GridPlugin,
  Light3dPlugin,
  MainCamera,
  MaterialPlugin,
  PrepassPlugin,
  Query,
  StandardMaterial,
  StandardMaterialPlugin,
} from '@retro-engine/engine';
import { vec3 } from '@retro-engine/math';
import { type Renderer } from '@retro-engine/renderer-core';

import { defaultEditorTransform, spawnEditorCamera } from './editor-camera';
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

      // The game "Main Camera" is authored scene content (see installShowcaseScene),
      // not spawned here. The editor redirects it into the Game tab each frame
      // (the Main Camera → Game tab system below).

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

  // Editor camera → Scene tab. On a panel resize the viewport reallocates its
  // texture; re-point the camera still holding the previous one at the new
  // texture (matched by the stale handle). The camera plugin re-reads `target`
  // each frame, so the swap takes effect next frame.
  app.addSystem('update', [Query([Camera])], (q) => {
    const stale = editorView.takeStale();
    if (stale === null || editorView.texture === null) return;
    const next = CameraRenderTarget.texture(editorView.texture);
    for (const row of q.entries()) {
      const camera = row[1] as Camera;
      if (camera.target.kind === 'texture' && camera.target.texture === stale) {
        camera.target = next;
      }
    }
  });

  // Main Camera → Game tab. The authored game camera loads with target =
  // primary (its build-time meaning: render to screen); redirect it into the
  // Game tab's offscreen texture every frame. Re-pointing only when it differs
  // covers both initial load (arrives as primary) and resize (arrives holding
  // the prior, now-freed texture) without leaning on a stale-texture match.
  app.addSystem('update', [Query([Camera, MainCamera])], (q) => {
    if (gameView.texture === null) return;
    for (const row of q.entries()) {
      const camera = row[1] as Camera;
      const target = camera.target;
      if (target.kind !== 'texture' || target.texture !== gameView.texture) {
        camera.target = CameraRenderTarget.texture(gameView.texture);
      }
    }
  });

  // Guarantee a Main Camera. Explicit authoring wins; if a loaded scene carries
  // none, promote the highest-order game camera so the Game tab isn't blank.
  // Editor infrastructure (the Scene-tab camera, the clear camera) is
  // EditorOnly, so it's never eligible — promotion only ever tags authored
  // content. The insert flushes next frame, when the redirect above picks it up.
  app.addSystem(
    'update',
    [Commands, Query([MainCamera]), Query([Camera], { without: [EditorOnly] })],
    (cmd, tagged, cameras) => {
      if (tagged.first() !== undefined) return;
      let best: { entity: Entity; order: number } | null = null;
      for (const row of cameras.entries()) {
        const order = (row[1] as Camera).order;
        if (best === null || order > best.order) best = { entity: row[0], order };
      }
      if (best !== null) cmd.entity(best.entity).insert(new MainCamera());
    },
  );
};
