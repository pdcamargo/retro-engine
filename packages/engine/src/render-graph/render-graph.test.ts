import { describe, expect, it } from 'bun:test';

import { createLabel } from './render-label';
import type { Node, NodeRunContext } from './node';
import { RenderGraph } from './render-graph';
import { RenderSubGraph } from './sub-graph';

const A = createLabel('test::a');
const B = createLabel('test::b');
const C = createLabel('test::c');
const SG = createLabel('test::sub');

interface Recorder {
  trace: string[];
}

const makeNode = (label: ReturnType<typeof createLabel>, recorder: Recorder): Node => ({
  label,
  input: () => [],
  output: () => [],
  run: () => recorder.trace.push(String(label)),
});

const emptyCtx = (graph: RenderGraph): NodeRunContext => ({
  app: undefined as never,
  graph,
  encoder: undefined,
  pass: undefined,
  view: undefined,
  renderSetSystems: new Map(),
  inputs: new Map(),
});

describe('RenderSubGraph', () => {
  it('runs nodes in topological order', () => {
    const recorder: Recorder = { trace: [] };
    const sub = new RenderSubGraph(SG);
    sub.addNode(makeNode(B, recorder));
    sub.addNode(makeNode(A, recorder));
    sub.addNode(makeNode(C, recorder));
    sub.addEdge(A, B);
    sub.addEdge(B, C);
    sub.freeze();
    sub.run(emptyCtx(new RenderGraph()));
    expect(recorder.trace).toEqual(['test::a', 'test::b', 'test::c']);
  });

  it('preserves insertion order as tiebreaker when no edge constrains', () => {
    const recorder: Recorder = { trace: [] };
    const sub = new RenderSubGraph(SG);
    sub.addNode(makeNode(A, recorder));
    sub.addNode(makeNode(B, recorder));
    sub.addNode(makeNode(C, recorder));
    sub.freeze();
    sub.run(emptyCtx(new RenderGraph()));
    expect(recorder.trace).toEqual(['test::a', 'test::b', 'test::c']);
  });

  it('throws on duplicate node label', () => {
    const recorder: Recorder = { trace: [] };
    const sub = new RenderSubGraph(SG);
    sub.addNode(makeNode(A, recorder));
    expect(() => sub.addNode(makeNode(A, recorder))).toThrow(/duplicate node label/);
  });

  it('throws on edge endpoint not registered', () => {
    const recorder: Recorder = { trace: [] };
    const sub = new RenderSubGraph(SG);
    sub.addNode(makeNode(A, recorder));
    expect(() => sub.addEdge(A, B)).toThrow(/edge endpoint not registered.*test::b/);
    expect(() => sub.addEdge(B, A)).toThrow(/edge endpoint not registered.*test::b/);
  });

  it('throws on self-loop', () => {
    const recorder: Recorder = { trace: [] };
    const sub = new RenderSubGraph(SG);
    sub.addNode(makeNode(A, recorder));
    expect(() => sub.addEdge(A, A)).toThrow(/self-loop/);
  });

  it('detects cycles with both labels in the message', () => {
    const recorder: Recorder = { trace: [] };
    const sub = new RenderSubGraph(SG);
    sub.addNode(makeNode(A, recorder));
    sub.addNode(makeNode(B, recorder));
    sub.addEdge(A, B);
    sub.addEdge(B, A);
    expect(() => sub.freeze()).toThrow(/cycle detected.*test::a.*test::b/);
  });

  it('freeze is idempotent', () => {
    const sub = new RenderSubGraph(SG);
    sub.freeze();
    sub.freeze();
    expect(sub.frozen).toBe(true);
  });

  it('post-freeze mutation throws', () => {
    const recorder: Recorder = { trace: [] };
    const sub = new RenderSubGraph(SG);
    sub.addNode(makeNode(A, recorder));
    sub.freeze();
    expect(() => sub.addNode(makeNode(B, recorder))).toThrow(/frozen/);
    expect(() => sub.addEdge(A, A)).toThrow(/frozen/);
  });

  it('run before freeze throws', () => {
    const sub = new RenderSubGraph(SG);
    expect(() => sub.run(emptyCtx(new RenderGraph()))).toThrow(/before freeze/);
  });
});

describe('RenderGraph', () => {
  it('empty graph freezes and runs without error', () => {
    const graph = new RenderGraph();
    graph.freeze();
    graph.run(emptyCtx(graph));
    expect(graph.frozen).toBe(true);
  });

  it('runs top-level nodes in topological order', () => {
    const recorder: Recorder = { trace: [] };
    const graph = new RenderGraph();
    graph.addNode(makeNode(C, recorder));
    graph.addNode(makeNode(A, recorder));
    graph.addNode(makeNode(B, recorder));
    graph.addEdge(A, C);
    graph.addEdge(A, B);
    graph.addEdge(B, C);
    graph.freeze();
    graph.run(emptyCtx(graph));
    expect(recorder.trace).toEqual(['test::a', 'test::b', 'test::c']);
  });

  it('throws on duplicate top-level node label', () => {
    const recorder: Recorder = { trace: [] };
    const graph = new RenderGraph();
    graph.addNode(makeNode(A, recorder));
    expect(() => graph.addNode(makeNode(A, recorder))).toThrow(/duplicate node label/);
  });

  it('throws on edge with unregistered endpoint', () => {
    const recorder: Recorder = { trace: [] };
    const graph = new RenderGraph();
    graph.addNode(makeNode(A, recorder));
    expect(() => graph.addEdge(A, B)).toThrow(/edge endpoint not registered.*test::b/);
  });

  it('throws on cycle at top level', () => {
    const recorder: Recorder = { trace: [] };
    const graph = new RenderGraph();
    graph.addNode(makeNode(A, recorder));
    graph.addNode(makeNode(B, recorder));
    graph.addEdge(A, B);
    graph.addEdge(B, A);
    expect(() => graph.freeze()).toThrow(/cycle detected.*test::a.*test::b/);
  });

  it('post-freeze mutation throws', () => {
    const recorder: Recorder = { trace: [] };
    const graph = new RenderGraph();
    graph.addNode(makeNode(A, recorder));
    graph.freeze();
    expect(() => graph.addNode(makeNode(B, recorder))).toThrow(/frozen/);
    expect(() => graph.addSubGraph(new RenderSubGraph(SG))).toThrow(/frozen/);
  });

  it('addSubGraph throws on duplicate label', () => {
    const graph = new RenderGraph();
    graph.addSubGraph(new RenderSubGraph(SG));
    expect(() => graph.addSubGraph(new RenderSubGraph(SG))).toThrow(/duplicate sub-graph label/);
  });

  it('getSubGraph returns the registered sub-graph or undefined', () => {
    const graph = new RenderGraph();
    const sub = new RenderSubGraph(SG);
    graph.addSubGraph(sub);
    expect(graph.getSubGraph(SG)).toBe(sub);
    expect(graph.getSubGraph(A)).toBeUndefined();
  });

  it('freeze cascades into every sub-graph', () => {
    const recorder: Recorder = { trace: [] };
    const graph = new RenderGraph();
    const sub = new RenderSubGraph(SG);
    sub.addNode(makeNode(A, recorder));
    sub.addNode(makeNode(B, recorder));
    sub.addEdge(B, A);
    graph.addSubGraph(sub);
    graph.freeze();
    expect(sub.frozen).toBe(true);
    sub.run(emptyCtx(graph));
    expect(recorder.trace).toEqual(['test::b', 'test::a']);
  });

  it('freeze propagates sub-graph cycles', () => {
    const recorder: Recorder = { trace: [] };
    const graph = new RenderGraph();
    const sub = new RenderSubGraph(SG);
    sub.addNode(makeNode(A, recorder));
    sub.addNode(makeNode(B, recorder));
    sub.addEdge(A, B);
    sub.addEdge(B, A);
    graph.addSubGraph(sub);
    expect(() => graph.freeze()).toThrow(/cycle detected/);
  });

  it('runSubGraph dispatches into the named sub-graph', () => {
    const recorder: Recorder = { trace: [] };
    const graph = new RenderGraph();
    const sub = new RenderSubGraph(SG);
    sub.addNode(makeNode(A, recorder));
    graph.addSubGraph(sub);
    graph.freeze();
    graph.runSubGraph(SG, emptyCtx(graph));
    expect(recorder.trace).toEqual(['test::a']);
  });

  it('runSubGraph throws on unknown label', () => {
    const graph = new RenderGraph();
    graph.freeze();
    expect(() => graph.runSubGraph(SG, emptyCtx(graph))).toThrow(/no sub-graph registered/);
  });

  it('run before freeze throws', () => {
    const graph = new RenderGraph();
    expect(() => graph.run(emptyCtx(graph))).toThrow(/before freeze/);
  });
});
