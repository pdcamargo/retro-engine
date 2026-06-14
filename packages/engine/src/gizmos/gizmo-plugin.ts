import type { App } from '../index';
import type { PluginObject } from '../plugin';
import { Core2dLabel } from '../render-graph/core-2d';
import { Core3dLabel } from '../render-graph/core-3d';
import { MotionBlurPass3dLabel } from '../motion-blur/motion-blur-node';
import { RenderGraph } from '../render-graph/render-graph';
import { TransparentPass2dLabel } from '../render-graph/transparent-pass-2d-node';
import { TransparentPass3dLabel } from '../render-graph/transparent-pass-3d-node';
import { RenderSet } from '../render-set';
import { ShaderRegistry } from '../shader/shader-registry';
import { ResMut } from '../system-param';
import { TaaPass3dLabel } from '../taa/taa-node';
import { TonemappingPass2dLabel, TonemappingPass3dLabel } from '../tonemapping/tonemapping-node';

import { GIZMO_WGSL } from './gizmo.wgsl';
import { GizmoMesh } from './gizmo-mesh';
import { GizmoPass2dLabel, GizmoPass3dLabel, makeGizmoPassNode } from './gizmo-pass-node';
import { Gizmos } from './gizmos';

/**
 * Wires the immediate-mode gizmo line system.
 *
 * Auto-installed by `CorePlugin`, so {@link Gizmos} is available to any system
 * via `ResMut(Gizmos)` out of the box. Registering it manually is harmless —
 * `isUnique()` is true, so a second `addPlugin(new GizmoPlugin())` throws.
 *
 * On `build`: registers the `retro_engine::gizmo` WGSL module, inserts the
 * {@link Gizmos} buffer and {@link GizmoMesh} GPU resource, and adds the
 * `RenderSet.Prepare` pack/upload system plus the `RenderSet.Cleanup` reset that
 * gives the buffer its per-frame immediate-mode semantics.
 *
 * On `finish` (after every other plugin's `build`, so the tonemap nodes are
 * present when HDR is in use): inserts the gizmo pass into both `Core2d` and
 * `Core3d`, ordered after the transparent pass and — when present — before
 * tonemapping, so gizmos land in the HDR intermediate and are tonemapped with
 * the scene.
 */
export class GizmoPlugin implements PluginObject {
  name(): string {
    return 'GizmoPlugin';
  }

  build(app: App): void {
    const registry = app.getResource(ShaderRegistry);
    if (registry === undefined) {
      throw new Error('GizmoPlugin: ShaderRegistry resource missing; ShaderPlugin must run before GizmoPlugin.');
    }
    registry.register('retro_engine::gizmo', GIZMO_WGSL);

    if (app.getResource(Gizmos) === undefined) app.insertResource(new Gizmos());
    if (app.getResource(GizmoMesh) === undefined) app.insertResource(new GizmoMesh());

    app.addSystem(
      'render',
      [ResMut(Gizmos), ResMut(GizmoMesh)],
      (gizmos, mesh) => {
        if (gizmos.count === 0) {
          mesh.draws = [];
          return;
        }
        if (!mesh.ensureInitialised(app)) return;
        mesh.prepare(app, gizmos);
      },
      { set: RenderSet.Prepare, label: 'gizmo-prepare' },
    );

    app.addSystem(
      'render',
      [ResMut(Gizmos)],
      (gizmos) => {
        gizmos.clear();
      },
      { set: RenderSet.Cleanup, label: 'gizmo-clear' },
    );
  }

  finish(app: App): void {
    const graph = app.getResource(RenderGraph);
    if (graph === undefined) {
      throw new Error('GizmoPlugin: RenderGraph resource missing at finish(); RenderGraphPlugin must build before GizmoPlugin.');
    }

    // The gizmo pass runs LAST and draws into the camera's final target, so all
    // edges point into it: after the transparent geometry and after every post
    // pass (TAA, motion blur, tonemap) that is present. This keeps handles out
    // of the HDR intermediate and the TAA temporal history.
    const sub3d = graph.getSubGraph(Core3dLabel);
    if (sub3d !== undefined) {
      sub3d.addNode(makeGizmoPassNode(GizmoPass3dLabel));
      sub3d.addEdge(TransparentPass3dLabel, GizmoPass3dLabel);
      if (sub3d.hasNode(TaaPass3dLabel)) sub3d.addEdge(TaaPass3dLabel, GizmoPass3dLabel);
      if (sub3d.hasNode(MotionBlurPass3dLabel)) sub3d.addEdge(MotionBlurPass3dLabel, GizmoPass3dLabel);
      if (sub3d.hasNode(TonemappingPass3dLabel)) sub3d.addEdge(TonemappingPass3dLabel, GizmoPass3dLabel);
    }

    const sub2d = graph.getSubGraph(Core2dLabel);
    if (sub2d !== undefined) {
      sub2d.addNode(makeGizmoPassNode(GizmoPass2dLabel));
      sub2d.addEdge(TransparentPass2dLabel, GizmoPass2dLabel);
      if (sub2d.hasNode(TonemappingPass2dLabel)) sub2d.addEdge(TonemappingPass2dLabel, GizmoPass2dLabel);
    }
  }
}
