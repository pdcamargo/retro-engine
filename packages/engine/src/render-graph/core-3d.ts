import { OpaquePass3dLabel, OpaquePass3dNode } from './opaque-pass-3d-node';
import { createLabel } from './render-label';
import { RenderSubGraph } from './sub-graph';
import {
  TransparentPass3dLabel,
  TransparentPass3dNode,
} from './transparent-pass-3d-node';

/**
 * Sub-graph label for the engine's default 3D pipeline.
 *
 * Cameras spawned via `Camera3d()` default to this label. The
 * `RenderGraphPlugin` registers a Phase 7 `Core3d` {@link RenderSubGraph} that
 * threads the camera through two phase passes:
 *
 * ```text
 * OpaquePass3dNode  →  TransparentPass3dNode
 * ```
 *
 * The opaque pass clears color + depth, draws every `Opaque3d` + `AlphaMask3d`
 * phase item front-to-back. The transparent pass loads the opaque output,
 * draws `Transparent3d` items back-to-front with no depth write. Items are
 * pushed into the per-camera `ViewPhases3d` resource by every
 * `MaterialPlugin<M>`'s queue system.
 *
 * Phase 10 expands this sub-graph with depth prepass + lighting nodes; Phase
 * 12 adds prepasses / post-processing. The phase-trio shape is the template
 * those phases append to.
 */
export const Core3dLabel = createLabel('core_3d');

/**
 * Construct the default `Core3d` sub-graph: the Phase 7 phase trio
 * (`OpaquePass3dNode → TransparentPass3dNode`). Called by
 * `RenderGraphPlugin.build()`. Plugins that need to inject extra nodes
 * (shadow prepass, tonemap, post-processing) should add them after the
 * sub-graph is registered and before the graph is frozen.
 */
export const buildCore3dSubGraph = (): RenderSubGraph => {
  const sub = new RenderSubGraph(Core3dLabel);
  sub.addNode(OpaquePass3dNode);
  sub.addNode(TransparentPass3dNode);
  sub.addEdge(OpaquePass3dLabel, TransparentPass3dLabel);
  return sub;
};
