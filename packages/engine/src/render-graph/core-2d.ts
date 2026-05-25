import { OpaquePass2dLabel, OpaquePass2dNode } from './opaque-pass-2d-node';
import { createLabel } from './render-label';
import { RenderSubGraph } from './sub-graph';
import { TransparentPass2dLabel, TransparentPass2dNode } from './transparent-pass-2d-node';

/**
 * Sub-graph label for the engine's default 2D pipeline.
 *
 * Cameras spawned via `Camera2d()` default to this label. The
 * `RenderGraphPlugin` registers a `Core2d` {@link RenderSubGraph} carrying the
 * `Opaque2d → Transparent2d` phase trio — the 2D twin of Core3d's phase trio
 * (`OpaquePass3dNode → TransparentPass3dNode`). Phase 12 will add post-process
 * nodes after the transparent pass.
 *
 * 2D rendering does not use a depth buffer; phase items are sorted by
 * `Transform.translation.z` (painter's algorithm) and the transparent pass
 * composites onto the opaque pass's output.
 */
export const Core2dLabel = createLabel('core_2d');

/**
 * Construct the default `Core2d` sub-graph: `OpaquePass2dNode → TransparentPass2dNode`.
 * Called by `RenderGraphPlugin.build()`. Plugins that need to inject extra
 * nodes (e.g. tonemap, bloom, post-process) should add them after the sub-
 * graph is registered and before the graph is frozen.
 */
export const buildCore2dSubGraph = (): RenderSubGraph => {
  const sub = new RenderSubGraph(Core2dLabel);
  sub.addNode(OpaquePass2dNode);
  sub.addNode(TransparentPass2dNode);
  sub.addEdge(OpaquePass2dLabel, TransparentPass2dLabel);
  return sub;
};
