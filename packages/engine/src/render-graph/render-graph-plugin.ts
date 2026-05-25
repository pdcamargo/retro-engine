import type { App } from '../index';
import type { PluginObject } from '../plugin';
import { RenderSet } from '../render-set';
import { ResMut } from '../system-param';

import { CameraDriverNode } from './camera-driver-node';
import { buildCore2dSubGraph } from './core-2d';
import { buildCore3dSubGraph } from './core-3d';
import { ViewPhases3d } from './phase-3d';
import { RenderGraph } from './render-graph';

/**
 * Engine-internal plugin that installs the {@link RenderGraph} resource and
 * registers the day-1 graph contents: the {@link CameraDriverNode} root, and
 * the `Core2d` and `Core3d` default sub-graphs (each containing a single
 * `MainPassNode`).
 *
 * Registered automatically by `CorePlugin` after `CameraPlugin` and
 * `VisibilityPlugin` so the graph resource is available before any user
 * plugin's `build` runs. User plugins extend the graph (adding their own
 * nodes / sub-graphs / edges) from `build` or `finish` — `App.renderFrame()`
 * calls `RenderGraph.freeze()` on its first invocation, at which point
 * further mutation throws.
 *
 * Unique. Re-adding it manually throws.
 */
export class RenderGraphPlugin implements PluginObject {
  name(): string {
    return 'RenderGraphPlugin';
  }

  build(app: App): void {
    const graph = new RenderGraph();
    graph.addNode(CameraDriverNode);
    graph.addSubGraph(buildCore2dSubGraph());
    graph.addSubGraph(buildCore3dSubGraph());
    app.insertResource(graph);
    app.insertResource(new ViewPhases3d());

    // Clear phase items at the head of `RenderSet.Queue` so every material
    // plugin's queue system can push fresh items each frame without an
    // explicit "reset" hook.
    app.addSystem(
      'render',
      [ResMut(ViewPhases3d)],
      (phases) => phases.clear(),
      { set: RenderSet.Queue },
    );
  }
}
