import { MainPassNode } from './main-pass-node';
import { createLabel } from './render-label';
import { RenderSubGraph } from './sub-graph';

/**
 * Sub-graph label for the engine's default 2D pipeline.
 *
 * Cameras spawned via {@link Camera2d} default to this label; the
 * `RenderGraphPlugin` registers a `Core2d` {@link RenderSubGraph} with a
 * single `MainPassNode` on day 1 (running the existing `RenderSet.Render`
 * systems). Phase 8 will replace that node with `Opaque2d` /
 * `AlphaMask2d` / `Transparent2d` phase nodes; Phase 12 will add post-process
 * nodes after them.
 */
export const Core2dLabel = createLabel('core_2d');

/**
 * Construct the default `Core2d` sub-graph: one {@link MainPassNode}. Called
 * by `RenderGraphPlugin.build()`. Plugins that need to inject extra nodes
 * (e.g. tonemap, bloom) should add them after the sub-graph is registered
 * and before the graph is frozen.
 */
export const buildCore2dSubGraph = (): RenderSubGraph => {
  const sub = new RenderSubGraph(Core2dLabel);
  sub.addNode(MainPassNode);
  return sub;
};
