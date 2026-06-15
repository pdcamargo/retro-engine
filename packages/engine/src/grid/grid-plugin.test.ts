import { describe, expect, it } from 'bun:test';

import {
  App,
  Camera3d,
  Core3dLabel,
  EditorGrid,
  GizmoPass3dLabel,
  GridPass3dLabel,
  GridPlugin,
  RenderGraph,
  ShaderRegistry,
  TransparentPass3dLabel,
} from '../index';
import { makeCapturingRenderer, makeStubCanvas } from '../test-utils';

const buildApp = () => {
  const { renderer, log } = makeCapturingRenderer();
  const app = new App({ renderer, canvas: makeStubCanvas() });
  // GridPlugin is opt-in (not auto-installed by CorePlugin), so editor hosts
  // add it explicitly.
  app.addPlugin(new GridPlugin());
  return { app, log };
};

describe('GridPlugin', () => {
  it('inserts the EditorGrid resource and registers the grid shader', () => {
    const { app } = buildApp();
    expect(app.getResource(EditorGrid)).toBeInstanceOf(EditorGrid);
    expect(app.getResource(ShaderRegistry)!.has('retro_engine::grid')).toBe(true);
  });

  it('defaults the grid to the XZ ground plane', () => {
    const { app } = buildApp();
    expect(app.getResource(EditorGrid)!.plane).toBe('xz');
  });

  it('inserts the grid node into the Core3d sub-graph', async () => {
    const { app } = buildApp();
    app.world.spawn(...Camera3d());
    await app.run();
    expect(app.getResource(RenderGraph)!.getSubGraph(Core3dLabel)!.hasNode(GridPass3dLabel)).toBe(true);
  });

  it('orders the grid pass after the transparent pass and before the gizmo pass', async () => {
    const { app } = buildApp();
    app.world.spawn(...Camera3d());
    await app.run();

    const ordered = app.getResource(RenderGraph)!.getSubGraph(Core3dLabel)!.orderedNodes()!.map((n) => String(n.label));
    const transparent = ordered.indexOf(String(TransparentPass3dLabel));
    const grid = ordered.indexOf(String(GridPass3dLabel));
    const gizmo = ordered.indexOf(String(GizmoPass3dLabel));
    expect(grid).toBeGreaterThan(transparent);
    expect(gizmo).toBeGreaterThan(grid);
  });
});
