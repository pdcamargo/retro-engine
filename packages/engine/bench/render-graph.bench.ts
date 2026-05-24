// Render-graph hot paths (Renderer Phase 5 / ADR-0023):
//
// - Graph build + freeze — runs once at App startup. Kahn's-algorithm topo
//   sort across the top-level graph and every sub-graph. Regression here =
//   colder cold-start as plugins grow more nodes.
// - RenderSubGraph.run() — invoked once per active camera per frame by
//   CameraDriverNode. Pure dispatch, no GPU work. Regression here = added
//   per-frame overhead proportional to (cameras × sub-graph nodes).
// - CameraDriverNode.run() — the full per-frame entry point. Iterates
//   SortedCameras, opens one encoder, dispatches each camera's sub-graph,
//   submits. With MainPassNode inside each sub-graph this is the canonical
//   "what does it cost to render N empty cameras per frame" measurement.
//
// See docs/adr/ADR-0017 (bench schema) and docs/adr/ADR-0023 (render graph).

import { bench, summary } from 'mitata';

import {
  CameraDriverNode,
  Core2dLabel,
  createLabel,
  EMPTY_SLOT_VALUES,
  MainPassNode,
  type Node,
  type NodeRunContext,
  RenderGraph,
  RenderSubGraph,
} from '../src/render-graph';

import { makeRenderingBenchRenderer } from './helpers';

const stubNode = (label: string): Node => ({
  label: createLabel(label),
  input: () => [],
  output: () => [],
  run: () => undefined,
});

const buildSubGraphWithStubs = (label: ReturnType<typeof createLabel>, n: number): RenderSubGraph => {
  const sub = new RenderSubGraph(label);
  for (let i = 0; i < n; i += 1) sub.addNode(stubNode(`bench::node_${i}`));
  // Chain: node_0 -> node_1 -> ... -> node_(n-1) so Kahn's has real work.
  for (let i = 0; i < n - 1; i += 1) {
    sub.addEdge(createLabel(`bench::node_${i}`), createLabel(`bench::node_${i + 1}`));
  }
  return sub;
};

const emptyCtx = (graph: RenderGraph): NodeRunContext => ({
  app: undefined as never,
  graph,
  encoder: undefined,
  pass: undefined,
  view: undefined,
  renderSetSystems: new Map(),
  inputs: EMPTY_SLOT_VALUES,
});

const NODE_COUNTS = [4, 16, 64] as const;

summary(() => {
  for (const n of NODE_COUNTS) {
    bench(`RenderGraph build + freeze @ ${n} nodes`, function* () {
      yield () => {
        const graph = new RenderGraph();
        const subLabel = createLabel('bench::sub');
        graph.addSubGraph(buildSubGraphWithStubs(subLabel, n));
        graph.freeze();
      };
    });
  }
});

summary(() => {
  for (const n of NODE_COUNTS) {
    bench(`RenderSubGraph dispatch @ ${n} stub nodes`, function* () {
      const graph = new RenderGraph();
      const subLabel = createLabel('bench::sub');
      const sub = buildSubGraphWithStubs(subLabel, n);
      graph.addSubGraph(sub);
      graph.freeze();
      const ctx = emptyCtx(graph);
      yield () => sub.run(ctx);
    });
  }
});

// Full per-frame dispatch path: CameraDriverNode iterates SortedCameras, opens
// the encoder, dispatches each camera's sub-graph (MainPassNode inside),
// submits. The bench skips Extract / Prepare by seeding the SortedCameras
// resource directly with synthetic CameraView entries — isolates the graph
// dispatch from the rest of the render schedule.

interface SyntheticCameraInput {
  readonly count: number;
}

const CAMERA_COUNTS: readonly SyntheticCameraInput[] = [
  { count: 1 },
  { count: 4 },
  { count: 16 },
];

import { mat4, vec3 } from '@retro-engine/math';

import { App, SortedCameras } from '../src';
import type { CameraView, Viewport } from '../src/camera/camera';

const buildSyntheticView = (
  renderer: ReturnType<typeof makeRenderingBenchRenderer>,
  i: number,
): CameraView => {
  const resolved = renderer.resolveRenderTarget({
    kind: 'surface',
    surface: renderer.createSurface({} as never),
  });
  const viewport: Viewport = {
    physicalPosition: { x: 0, y: 0 },
    physicalSize: { width: resolved.width, height: resolved.height },
    depth: { min: 0, max: 1 },
  };
  return {
    renderEntity: i,
    sourceEntity: i,
    order: i,
    target: resolved,
    viewport,
    clearColor: { r: 0, g: 0, b: 0, a: 1 },
    loadOp: 'clear',
    viewMatrix: mat4.identity(),
    projectionMatrix: mat4.identity(),
    viewProjectionMatrix: mat4.identity(),
    worldPosition: vec3.create(0, 0, 0),
    renderLayers: 1,
    viewBindGroup: renderer.createBindGroup({} as never),
    viewBuffer: renderer.createBuffer({ size: 256, usage: 0 } as never),
    subGraph: Core2dLabel,
  };
};

summary(() => {
  for (const { count } of CAMERA_COUNTS) {
    bench(`CameraDriverNode dispatch @ ${count} cameras (Core2d, MainPassNode)`, function* () {
      const renderer = makeRenderingBenchRenderer();
      const app = new App({ renderer });
      // Bypass Extract / Prepare: seed SortedCameras directly so each iteration
      // measures only the CameraDriverNode + MainPassNode work.
      const sorted = app.getResource(SortedCameras)!;
      sorted.views = [];
      for (let i = 0; i < count; i += 1) sorted.views.push(buildSyntheticView(renderer, i));
      const graph = app.getResource(RenderGraph)!;
      graph.freeze();
      const ctx: NodeRunContext = {
        app,
        graph,
        encoder: undefined,
        pass: undefined,
        view: undefined,
        renderSetSystems: new Map(),
        inputs: EMPTY_SLOT_VALUES,
      };
      yield () => CameraDriverNode.run(ctx);
    });
  }
});

// `MainPassNode` runs inside the Core2d sub-graph via `RenderGraphPlugin`;
// referenced here so a reader chasing the dispatch path lands on the symbol.
void MainPassNode;
