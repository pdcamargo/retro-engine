import { MainPassNode } from './main-pass-node';
import { createLabel } from './render-label';
import { RenderSubGraph } from './sub-graph';

/**
 * Sub-graph label for the engine's default 3D pipeline.
 *
 * Cameras spawned via {@link Camera3d} default to this label; the
 * `RenderGraphPlugin` registers a `Core3d` {@link RenderSubGraph} with a
 * single `MainPassNode` on day 1 (running the existing `RenderSet.Render`
 * systems, no depth attachment yet). Phase 10 adds depth + lighting nodes;
 * Phase 12 adds prepasses and post-processing.
 */
export const Core3dLabel = createLabel('core_3d');

/**
 * Construct the default `Core3d` sub-graph: one {@link MainPassNode}. Called
 * by `RenderGraphPlugin.build()`. Plugins that need to inject extra nodes
 * (e.g. shadow prepass, tonemap) should add them after the sub-graph is
 * registered and before the graph is frozen.
 */
export const buildCore3dSubGraph = (): RenderSubGraph => {
  const sub = new RenderSubGraph(Core3dLabel);
  sub.addNode(MainPassNode);
  return sub;
};
