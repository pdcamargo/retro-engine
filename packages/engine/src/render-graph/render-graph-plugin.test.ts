import { describe, expect, it } from 'bun:test';

import { App, Camera2d, Camera3d, createLabel, RenderGraph, RenderSubGraph } from '../index';
import { makeRenderingRenderer, makeStubCanvas } from '../test-utils';

import { Core2dLabel } from './core-2d';
import { Core3dLabel } from './core-3d';
import { CameraDriverLabel } from './camera-driver-node';
import { MainPassLabel } from './main-pass-node';

describe('RenderGraphPlugin', () => {
  it('installs RenderGraph as an App resource with the default Core2d / Core3d sub-graphs', () => {
    const app = new App({ renderer: makeRenderingRenderer(), canvas: makeStubCanvas() });
    const graph = app.getResource(RenderGraph);
    expect(graph).toBeDefined();
    expect(graph!.getSubGraph(Core2dLabel)).toBeDefined();
    expect(graph!.getSubGraph(Core3dLabel)).toBeDefined();
  });

  it('registers CameraDriverNode as the only top-level node by default', async () => {
    const app = new App({ renderer: makeRenderingRenderer(), canvas: makeStubCanvas() });
    await app.run();
    const graph = app.getResource(RenderGraph)!;
    const order = graph.orderedNodes()!;
    expect(order.map((n) => String(n.label))).toEqual([String(CameraDriverLabel)]);
  });

  it("default sub-graphs each contain the MainPassNode", () => {
    const app = new App({ renderer: makeRenderingRenderer(), canvas: makeStubCanvas() });
    const graph = app.getResource(RenderGraph)!;
    // freeze is required before orderedNodes returns
    graph.freeze();
    const core2d = graph.getSubGraph(Core2dLabel)!;
    const core3d = graph.getSubGraph(Core3dLabel)!;
    expect(core2d.orderedNodes()!.map((n) => String(n.label))).toEqual([String(MainPassLabel)]);
    expect(core3d.orderedNodes()!.map((n) => String(n.label))).toEqual([String(MainPassLabel)]);
  });

  it('freezes the graph on the first frame; further mutation throws', async () => {
    const app = new App({ renderer: makeRenderingRenderer(), canvas: makeStubCanvas() });
    app.world.spawn(...Camera2d());
    await app.run();
    const graph = app.getResource(RenderGraph)!;
    expect(graph.frozen).toBe(true);
    expect(() => graph.addSubGraph(new RenderSubGraph(createLabel('test::late')))).toThrow(/frozen/);
  });
});

describe('CameraDriverNode dispatch', () => {
  it('runs each camera through its declared sub-graph', async () => {
    const app = new App({ renderer: makeRenderingRenderer(), canvas: makeStubCanvas() });
    app.world.spawn(...Camera2d({ order: 0 }));
    app.world.spawn(...Camera3d({ order: 1 }));
    const visited2d: number[] = [];
    const visited3d: number[] = [];

    // Inject probe nodes into each default sub-graph before the first frame.
    const graph = app.getResource(RenderGraph)!;
    const core2d = graph.getSubGraph(Core2dLabel)!;
    const core3d = graph.getSubGraph(Core3dLabel)!;
    const probe2dLabel = createLabel('test::probe2d');
    const probe3dLabel = createLabel('test::probe3d');
    core2d.addNode({
      label: probe2dLabel,
      input: () => [],
      output: () => [],
      run: (ctx) => {
        if (ctx.view) visited2d.push(ctx.view.sourceEntity);
      },
    });
    core3d.addNode({
      label: probe3dLabel,
      input: () => [],
      output: () => [],
      run: (ctx) => {
        if (ctx.view) visited3d.push(ctx.view.sourceEntity);
      },
    });

    await app.run();
    expect(visited2d).toHaveLength(1);
    expect(visited3d).toHaveLength(1);
    expect(visited2d[0]).not.toBe(visited3d[0]);
  });

  it('warns and skips a camera whose sub-graph label is not registered', async () => {
    const messages: string[] = [];
    const app = new App({
      renderer: makeRenderingRenderer(),
      canvas: makeStubCanvas(),
      logger: {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
        debug: () => undefined,
        devWarn: (m: string) => messages.push(m),
        child: function () {
          return this;
        },
      } as never,
    });
    const missing = createLabel('test::not_registered');
    app.world.spawn(...Camera2d({ subGraph: missing }));
    await app.run();
    expect(messages.some((m) => m.includes('test::not_registered'))).toBe(true);
  });

  it('only emits the missing-sub-graph warning once per label per frame', async () => {
    const messages: string[] = [];
    const app = new App({
      renderer: makeRenderingRenderer(),
      canvas: makeStubCanvas(),
      logger: {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
        debug: () => undefined,
        devWarn: (m: string) => messages.push(m),
        child: function () {
          return this;
        },
      } as never,
    });
    const missing = createLabel('test::not_registered');
    app.world.spawn(...Camera2d({ subGraph: missing, order: 0 }));
    app.world.spawn(...Camera2d({ subGraph: missing, order: 1 }));
    await app.run();
    expect(messages.filter((m) => m.includes('test::not_registered'))).toHaveLength(1);
  });
});
