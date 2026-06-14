import { describe, expect, it } from 'bun:test';

import { color, vec3 } from '@retro-engine/math';

import {
  App,
  Camera2d,
  Camera3d,
  Core2dLabel,
  Core3dLabel,
  DepthPrepass,
  EDITOR_GIZMO_LAYER,
  EDITOR_GIZMO_MASK,
  Gizmos,
  GizmoMesh,
  GizmoPass2dLabel,
  GizmoPass3dLabel,
  GizmoPlugin,
  Light3dPlugin,
  MaterialPlugin,
  MotionVectorPrepass,
  PrepassPlugin,
  RenderGraph,
  RenderLayers,
  ResMut,
  ShaderRegistry,
  StandardMaterial,
  StandardMaterialPlugin,
  Taa,
  TaaPass3dLabel,
  TonemappingPass3dLabel,
  TransparentPass3dLabel,
} from '../index';
import { makeCapturingRenderer, makeStubCanvas } from '../test-utils';

const buildApp = () => {
  const { renderer, log } = makeCapturingRenderer();
  const app = new App({ renderer, canvas: makeStubCanvas() });
  app.addPlugin(new StandardMaterialPlugin());
  app.addPlugin(new MaterialPlugin(StandardMaterial));
  app.addPlugin(new Light3dPlugin());
  app.addPlugin(new PrepassPlugin());
  return { app, log };
};

const white = color(1, 1, 1, 1);
const gizmoPasses = (log: ReturnType<typeof makeCapturingRenderer>['log']) =>
  log.passes.filter((p) => p.label?.endsWith('.gizmo'));

describe('GizmoPlugin', () => {
  it('inserts the Gizmos + GizmoMesh resources and registers the shader', () => {
    const { app } = buildApp();
    expect(app.getResource(Gizmos)).toBeInstanceOf(Gizmos);
    expect(app.getResource(GizmoMesh)).toBeInstanceOf(GizmoMesh);
    expect(app.getResource(ShaderRegistry)!.has('retro_engine::gizmo')).toBe(true);
  });

  it('is unique — adding it twice throws', () => {
    const { app } = buildApp();
    // GizmoPlugin is auto-added by CorePlugin; re-adding it proves uniqueness.
    expect(() => app.addPlugin(new GizmoPlugin())).toThrow(/unique/);
  });

  it('orders the Core3d gizmo pass last — after TAA and tonemapping', async () => {
    const { app } = buildApp();
    app.world.spawn(...Camera3d({ hdr: true }), new DepthPrepass(), new MotionVectorPrepass(), new Taa());
    await app.run();

    const ordered = app.getResource(RenderGraph)!.getSubGraph(Core3dLabel)!.orderedNodes()!.map((n) => String(n.label));
    const transparent = ordered.indexOf(String(TransparentPass3dLabel));
    const taa = ordered.indexOf(String(TaaPass3dLabel));
    const gizmo = ordered.indexOf(String(GizmoPass3dLabel));
    const tonemap = ordered.indexOf(String(TonemappingPass3dLabel));
    expect(gizmo).toBeGreaterThan(transparent);
    expect(gizmo).toBeGreaterThan(taa);
    expect(gizmo).toBeGreaterThan(tonemap);
  });

  it('inserts a gizmo node into both the Core2d and Core3d sub-graphs', async () => {
    const { app } = buildApp();
    app.world.spawn(...Camera2d());
    await app.run();
    expect(app.getResource(RenderGraph)!.getSubGraph(Core2dLabel)!.hasNode(GizmoPass2dLabel)).toBe(true);
    expect(app.getResource(RenderGraph)!.getSubGraph(Core3dLabel)!.hasNode(GizmoPass3dLabel)).toBe(true);
  });

  it('draws an editor-layer gizmo only for the camera that includes that layer', async () => {
    const { app, log } = buildApp();
    // Editor camera opts into the editor gizmo layer; the game camera keeps the default mask.
    app.world.spawn(
      ...Camera3d({ hdr: true, order: 0 }),
      new DepthPrepass(),
      new MotionVectorPrepass(),
      new Taa(),
      RenderLayers.layers(0, EDITOR_GIZMO_LAYER),
    );
    app.world.spawn(...Camera3d({ hdr: true, order: 1 }), new DepthPrepass(), new MotionVectorPrepass(), new Taa());

    app.addSystem('update', [ResMut(Gizmos)], (g) => {
      g.line(vec3.create(0, 0, 0), vec3.create(0, 1, 0), white, { layer: EDITOR_GIZMO_MASK });
    });

    await app.run();

    const passes = gizmoPasses(log);
    // Exactly one camera draws the editor-layer gizmo.
    expect(passes).toHaveLength(1);
    const draws = passes[0]!.drawCalls.filter((c) => c.kind === 'draw');
    expect(draws).toHaveLength(1);
    expect(draws[0]!.draw!.vertexCount).toBe(2);
  });

  it('draws a default-layer gizmo for every camera', async () => {
    const { app, log } = buildApp();
    app.world.spawn(...Camera3d({ hdr: true, order: 0 }), new DepthPrepass(), new MotionVectorPrepass(), new Taa());
    app.world.spawn(...Camera2d({ order: 1 }));

    app.addSystem('update', [ResMut(Gizmos)], (g) => {
      g.line(vec3.create(0, 0, 0), vec3.create(1, 0, 0), white); // default layer
    });

    await app.run();
    expect(gizmoPasses(log).length).toBe(2);
  });
});
