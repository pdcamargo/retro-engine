import {
  type App,
  AmbientLight,
  Camera,
  Camera2d,
  Camera3d,
  CameraRenderTarget,
  ClearColorConfig,
  Commands,
  Cuboid,
  DepthPrepass,
  DirectionalLight3d,
  GridPlugin,
  Light3dPlugin,
  MaterialPlugin,
  Mesh3d,
  Meshes,
  MotionVectorPrepass,
  Plane3d,
  PrepassPlugin,
  Query,
  ResMut,
  Sphere,
  StandardMaterial,
  StandardMaterialPlugin,
  Taa,
  Torus,
  Transform,
} from '@retro-engine/engine';
import { quat, vec3, vec4 } from '@retro-engine/math';
import { type Renderer } from '@retro-engine/renderer-core';

import { defaultEditorTransform, lookFrom, spawnEditorCamera } from './editor-camera';
import { EditorGizmo } from './gizmo-wiring';
import { type ViewportTarget } from './viewport';

/**
 * Register the rendering plugins, insert ambient light, spawn the demo scene
 * (ground + a few lit/shadowed primitives + a sun), and stand up the editor and
 * game cameras that render into the two viewport textures. Reference content for
 * "the engine is renderable in the editor" — swap for a loaded scene later.
 */
export const setupViewportScene = (
  app: App,
  renderer: Renderer,
  editorView: ViewportTarget,
  gameView: ViewportTarget,
): void => {
  const stdMat = new MaterialPlugin(StandardMaterial);
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
    [Commands, ResMut(Meshes), ResMut(stdMat.Materials)],
    (cmd, meshes, materials) => {
      editorView.init(renderer);
      gameView.init(renderer);

      const groundMesh = meshes.add(new Plane3d().mesh().build());
      const cubeMesh = meshes.add(new Cuboid().mesh().build());
      const sphereMesh = meshes.add(new Sphere({ radius: 0.6 }).mesh().uv(48, 32).build());
      const torusMesh = meshes.add(new Torus({ majorRadius: 0.55, minorRadius: 0.2 }).mesh().build());

      const groundMat = materials.add(
        new StandardMaterial({ baseColor: vec4.create(0.62, 0.64, 0.66, 1), roughness: 0.92 }),
      );
      const redMat = materials.add(
        new StandardMaterial({ baseColor: vec4.create(0.85, 0.23, 0.27, 1), roughness: 0.55 }),
      );
      const blueMat = materials.add(
        new StandardMaterial({
          baseColor: vec4.create(0.22, 0.45, 0.85, 1),
          metallic: 0.1,
          roughness: 0.25,
        }),
      );
      const goldMat = materials.add(
        new StandardMaterial({
          baseColor: vec4.create(0.9, 0.72, 0.28, 1),
          metallic: 0.9,
          roughness: 0.3,
        }),
      );
      const violetMat = materials.add(
        new StandardMaterial({
          baseColor: vec4.create(0.55, 0.4, 0.85, 1),
          metallic: 0.2,
          roughness: 0.4,
        }),
      );

      // Ground: the unit plane scaled to a 20×20 floor.
      cmd.spawn(
        new Mesh3d(groundMesh),
        new stdMat.MeshMaterial3d(groundMat),
        new Transform(vec3.create(0, 0, 0), undefined, vec3.create(20, 1, 20)),
      );
      // Each manipulable primitive carries a different gizmo mode (see
      // gizmo-wiring.ts) so the Scene viewport shows Move, Rotate, Scale, and the
      // combined "All" gizmo side by side.
      // Spread across a ~6-unit square so the four constant-size gizmos never
      // overlap (each spans roughly two units on screen).
      cmd.spawn(
        new Mesh3d(cubeMesh),
        new stdMat.MeshMaterial3d(redMat),
        new Transform(vec3.create(-3, 0.5, -2.5)),
        new EditorGizmo('move'),
      );
      cmd.spawn(
        new Mesh3d(sphereMesh),
        new stdMat.MeshMaterial3d(blueMat),
        new Transform(vec3.create(3, 0.6, -2.5)),
        new EditorGizmo('rotate'),
      );
      const goldTransform = new Transform(
        vec3.create(3, 0.7, 2.5),
        undefined,
        vec3.create(0.8, 1.4, 0.8),
      );
      quat.fromEuler(0, 0.6, 0, 'xyz', goldTransform.rotation);
      cmd.spawn(
        new Mesh3d(cubeMesh),
        new stdMat.MeshMaterial3d(goldMat),
        goldTransform,
        new EditorGizmo('scale'),
      );
      // Fourth element: a torus with the combined Move/Rotate/Scale gizmo.
      const torusTransform = new Transform(vec3.create(-3, 0.7, 2.5));
      quat.fromEuler(Math.PI / 2, 0, 0, 'xyz', torusTransform.rotation);
      cmd.spawn(
        new Mesh3d(torusMesh),
        new stdMat.MeshMaterial3d(violetMat),
        torusTransform,
        new EditorGizmo('all'),
      );

      // Sun: a directional light aimed down toward the ground (forward = −Z).
      const sunTransform = new Transform();
      quat.fromEuler(-Math.PI / 3, Math.PI / 5, 0, 'xyz', sunTransform.rotation);
      cmd.spawn(new DirectionalLight3d({ intensity: 3.2 }), sunTransform);

      // Editor camera → Scene tab. Spawned in perspective; the view toggle
      // swaps its projection to orthographic on demand. The controller drives
      // navigation; this just stands up the initial camera framing the demo.
      spawnEditorCamera(cmd, editorView.texture!, defaultEditorTransform());

      // Game camera → Game tab. Renders every frame regardless of play state;
      // Play will later gate simulation systems, never this render.
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
      );

      // Clear-only primary camera: nothing else targets the swapchain, so this
      // opens the one pass that clears it before the ImGui overlay composites
      // (the overlay loads, not clears). Without it the dock gaps show garbage.
      cmd.spawn(
        ...Camera2d({
          order: -100,
          clearColor: ClearColorConfig.custom({ r: 0.027, g: 0.043, b: 0.039, a: 1 }),
        }),
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
