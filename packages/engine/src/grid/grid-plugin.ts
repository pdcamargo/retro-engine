import { GizmoPass3dLabel } from '../gizmos/gizmo-pass-node';
import type { App } from '../index';
import { MotionBlurPass3dLabel } from '../motion-blur/motion-blur-node';
import type { PluginObject } from '../plugin';
import { Core3dLabel } from '../render-graph/core-3d';
import { RenderGraph } from '../render-graph/render-graph';
import { TransparentPass3dLabel } from '../render-graph/transparent-pass-3d-node';
import { RenderSet } from '../render-set';
import { ShaderRegistry } from '../shader/shader-registry';
import { ResMut } from '../system-param';
import { TaaPass3dLabel } from '../taa/taa-node';
import { TonemappingPass3dLabel } from '../tonemapping/tonemapping-node';

import { EditorGrid } from './grid-config';
import { GRID_WGSL } from './grid.wgsl';
import { GridPass3dLabel, makeGridPassNode } from './grid-pass-node';
import { GridRenderState } from './grid-render-state';

/**
 * Wires the editor ground-plane grid.
 *
 * Opt-in: unlike {@link GizmoPlugin}, this is **not** auto-installed by
 * `CorePlugin`, so a shipped game pays nothing for it. Editor hosts add it
 * explicitly with `app.addPlugin(new GridPlugin())`.
 *
 * On `build`: registers the `retro_engine::grid` WGSL module, inserts the
 * {@link EditorGrid} config resource and the {@link GridRenderState} GPU
 * resource, and adds the `RenderSet.Prepare` system that uploads the config
 * uniform each frame.
 *
 * On `finish` (after every other plugin's `build`, so the tonemap and gizmo
 * nodes exist): inserts the grid pass into `Core3d`, ordered after the
 * transparent pass and every present post pass (TAA, motion blur, tonemap),
 * and before the gizmo pass so transform handles draw on top.
 *
 * The single pass serves both editor viewing modes: {@link EditorGrid.plane}
 * selects the XZ ground plane (perspective 3D camera) or the XY work plane
 * (orthographic 2D camera), and the shader sizes and fades the grid
 * accordingly. An editor that toggles its viewport between perspective and
 * orthographic drives `plane` in step.
 */
export class GridPlugin implements PluginObject {
  name(): string {
    return 'GridPlugin';
  }

  build(app: App): void {
    const registry = app.getResource(ShaderRegistry);
    if (registry === undefined) {
      throw new Error('GridPlugin: ShaderRegistry resource missing; ShaderPlugin must run before GridPlugin.');
    }
    registry.register('retro_engine::grid', GRID_WGSL);

    if (app.getResource(EditorGrid) === undefined) app.insertResource(new EditorGrid());
    if (app.getResource(GridRenderState) === undefined) app.insertResource(new GridRenderState());

    app.addSystem(
      'render',
      [ResMut(EditorGrid), ResMut(GridRenderState)],
      (config, state) => {
        if (!config.enabled) return;
        if (!state.ensureInitialised(app)) return;
        state.prepare(app, config);
      },
      { set: RenderSet.Prepare, label: 'grid-prepare' },
    );
  }

  finish(app: App): void {
    const graph = app.getResource(RenderGraph);
    if (graph === undefined) {
      throw new Error('GridPlugin: RenderGraph resource missing at finish(); RenderGraphPlugin must build before GridPlugin.');
    }

    const sub3d = graph.getSubGraph(Core3dLabel);
    if (sub3d === undefined) return;
    sub3d.addNode(makeGridPassNode(GridPass3dLabel));
    sub3d.addEdge(TransparentPass3dLabel, GridPass3dLabel);
    if (sub3d.hasNode(TaaPass3dLabel)) sub3d.addEdge(TaaPass3dLabel, GridPass3dLabel);
    if (sub3d.hasNode(MotionBlurPass3dLabel)) sub3d.addEdge(MotionBlurPass3dLabel, GridPass3dLabel);
    if (sub3d.hasNode(TonemappingPass3dLabel)) sub3d.addEdge(TonemappingPass3dLabel, GridPass3dLabel);
    // Grid under gizmos: handles must remain on top.
    if (sub3d.hasNode(GizmoPass3dLabel)) sub3d.addEdge(GridPass3dLabel, GizmoPass3dLabel);
  }
}
