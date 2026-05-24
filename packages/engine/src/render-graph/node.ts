import type { CommandEncoder, RenderPassEncoder } from '@retro-engine/renderer-core';

import type { CameraView } from '../camera/camera';
import type { App } from '../index';
import type { RegisteredSystem } from '../schedule';
import type { RenderSetName } from '../render-set';

import type { RenderLabel } from './render-label';
import type { RenderGraph } from './render-graph';
import type { SlotInfo, SlotValues } from './slot';

/**
 * Per-invocation context passed to every {@link Node.run} call.
 *
 * Most fields are set by the parent node that drives this one:
 *
 * - The {@link CameraDriverNode} root sets {@link encoder} once per frame and
 *   {@link view} once per active camera before invoking each camera's sub-graph.
 * - A sub-graph pass node (e.g. `Core2dPassNode`) sets {@link pass} after it
 *   calls `encoder.beginRenderPass`, so inner nodes can record draws against
 *   the open pass.
 *
 * Nodes never construct a {@link NodeRunContext} themselves; they receive one
 * from the runner that invoked them.
 */
export interface NodeRunContext {
  /** Owning {@link App}; node implementations use it for resource access and render-set dispatch. */
  readonly app: App;
  /** The graph executing this node. Use to look up sub-graphs. */
  readonly graph: RenderGraph;
  /** Active command encoder for the current frame, or `undefined` outside the per-frame block. */
  readonly encoder: CommandEncoder | undefined;
  /** Active render pass, or `undefined` outside a pass-owning node. */
  readonly pass: RenderPassEncoder | undefined;
  /** The current camera view when running inside a per-camera sub-graph, otherwise `undefined`. */
  readonly view: CameraView | undefined;
  /**
   * Render-stage systems pre-grouped by their {@link RenderSetName}.
   * Computed once per frame by `App.renderFrame()` and threaded through so
   * `MainPassNode` can dispatch `RenderSet.Render` systems without re-grouping.
   */
  readonly renderSetSystems: ReadonlyMap<RenderSetName, readonly RegisteredSystem[]>;
  /** Values flowing in via the node's declared input slots. Empty for every built-in node today. */
  readonly inputs: SlotValues;
}

/**
 * One pass-shaped unit of work inside a {@link RenderGraph}.
 *
 * Implementations declare their identifying {@link label} plus typed input
 * and output {@link SlotInfo} lists, then implement {@link run} to record
 * commands against the {@link NodeRunContext}. Nodes are values, not
 * subclasses: implement the interface on a plain object or class — there is
 * no base class to extend.
 *
 * @example
 * ```ts
 * import { createLabel, type Node } from '@retro-engine/engine';
 *
 * const MyNodeLabel = createLabel('my_plugin::my_node');
 *
 * const myNode: Node = {
 *   label: MyNodeLabel,
 *   input: () => [],
 *   output: () => [],
 *   run: (ctx) => {
 *     // record commands against ctx.pass / ctx.encoder
 *   },
 * };
 * ```
 */
export interface Node {
  /** Stable identity used for edges and registry lookup. */
  readonly label: RenderLabel;
  /** Inputs this node consumes. May be empty. */
  input(): readonly SlotInfo[];
  /** Outputs this node produces. May be empty. */
  output(): readonly SlotInfo[];
  /** Record commands and dispatch child sub-graphs as needed. */
  run(ctx: NodeRunContext): void;
}

/**
 * A {@link Node} that expects {@link NodeRunContext.view} to be set when it
 * runs — i.e. one invoked once per active camera inside a camera-driven
 * sub-graph. The brand exists for documentation and to make
 * `isViewNode(node)` cheap; the runner does not enforce the contract beyond
 * supplying `view` when it has one.
 */
export interface ViewNode extends Node {
  readonly __viewNode: true;
}

/** True if `node` was declared as a {@link ViewNode}. */
export const isViewNode = (node: Node): node is ViewNode =>
  (node as ViewNode).__viewNode === true;
