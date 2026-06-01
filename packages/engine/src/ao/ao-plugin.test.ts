import { vec4 } from '@retro-engine/math';
import { describe, expect, it } from 'bun:test';

import {
  App,
  AoBlurPass3dLabel,
  AoGtaoPass3dLabel,
  AoTemporalPass3dLabel,
  Camera3d,
  Core3dLabel,
  Cuboid,
  DepthPrepass,
  Light3dPlugin,
  MaterialPlugin,
  Mesh3d,
  Meshes,
  MotionVectorPrepass,
  NormalPrepass,
  OpaquePass3dLabel,
  PrepassNode3dLabel,
  PrepassPlugin,
  RenderGraph,
  ScreenSpaceAo,
  StandardMaterial,
  StandardMaterialPlugin,
  ViewAo,
  ViewAoTargets,
} from '../index';
import { makeCapturingRenderer, makeStubCanvas } from '../test-utils';

/** App with the StandardMaterial + prepass plumbing AO depends on. */
const buildApp = () => {
  const { renderer, log } = makeCapturingRenderer();
  const app = new App({ renderer, canvas: makeStubCanvas() });
  app.addPlugin(new StandardMaterialPlugin());
  const pbr = new MaterialPlugin(StandardMaterial);
  app.addPlugin(pbr);
  app.addPlugin(new Light3dPlugin());
  app.addPlugin(new PrepassPlugin());
  return { app, pbr, log };
};

const spawnMesh = (app: App, pbr: MaterialPlugin<StandardMaterial>) => {
  const mesh = app.getResource(Meshes)!.add(new Cuboid().mesh().build());
  const mat = app
    .getResource(pbr.Materials)!
    .add(new StandardMaterial({ baseColor: vec4.create(1, 1, 1, 1) }));
  app.world.spawn(new Mesh3d(mesh), new pbr.MeshMaterial3d(mat));
};

describe('ScreenSpaceAo component', () => {
  it('defaults to radius 0.5, intensity 1, 2 slices, 8 steps', () => {
    const ao = new ScreenSpaceAo();
    expect(ao.radius).toBe(0.5);
    expect(ao.intensity).toBe(1.0);
    expect(ao.slices).toBe(2);
    expect(ao.steps).toBe(8);
  });

  it('honors overrides', () => {
    const ao = new ScreenSpaceAo({ radius: 1.5, intensity: 2, bias: 0.2, slices: 4, steps: 12 });
    expect(ao.radius).toBe(1.5);
    expect(ao.intensity).toBe(2);
    expect(ao.bias).toBe(0.2);
    expect(ao.slices).toBe(4);
    expect(ao.steps).toBe(12);
  });
});

describe('AoPlugin (integration)', () => {
  it('orders the Core3d nodes Prepass → AO GTAO → AO blur → Opaque', async () => {
    const { app } = buildApp();
    app.world.spawn(...Camera3d(), new DepthPrepass(), new NormalPrepass(), new ScreenSpaceAo());
    await app.run();

    const sub = app.getResource(RenderGraph)!.getSubGraph(Core3dLabel)!;
    const ordered = sub.orderedNodes()!.map((n) => String(n.label));
    const pp = ordered.indexOf(String(PrepassNode3dLabel));
    const ao = ordered.indexOf(String(AoGtaoPass3dLabel));
    const blur = ordered.indexOf(String(AoBlurPass3dLabel));
    const temporal = ordered.indexOf(String(AoTemporalPass3dLabel));
    const op = ordered.indexOf(String(OpaquePass3dLabel));
    expect(pp).toBeGreaterThanOrEqual(0);
    expect(ao).toBeGreaterThan(pp);
    expect(blur).toBeGreaterThan(ao);
    expect(temporal).toBeGreaterThan(blur);
    expect(op).toBeGreaterThan(temporal);
  });

  it('runs the GTAO + blur fullscreen draws for a camera with depth + normal prepass', async () => {
    const { app, pbr, log } = buildApp();
    spawnMesh(app, pbr);
    app.world.spawn(
      ...Camera3d({ hdr: true }),
      new DepthPrepass(),
      new NormalPrepass(),
      new ScreenSpaceAo(),
    );
    await app.run();

    for (const suffix of ['.ao-gtao', '.ao-blur']) {
      const pass = log.passes.find((p) => p.label?.endsWith(suffix));
      expect(pass).toBeDefined();
      const draws = pass!.drawCalls.filter((c) => c.kind === 'draw');
      expect(draws).toHaveLength(1);
      expect(draws[0]!.draw!.vertexCount).toBe(3);
    }
  });

  it('allocates a per-camera AO target only when depth + normal prepass are present', async () => {
    const { app, pbr } = buildApp();
    spawnMesh(app, pbr);
    const cam = app.world.spawn(
      ...Camera3d(),
      new DepthPrepass(),
      new NormalPrepass(),
      new ScreenSpaceAo(),
    );
    await app.run();
    expect(app.getResource(ViewAoTargets)!.perCamera.get(cam)).toBeDefined();
    expect(app.getResource(ViewAo)!.byCamera.get(cam)).toBeDefined();
  });

  it('skips (no pass, no target) when NormalPrepass is absent', async () => {
    const { app, pbr, log } = buildApp();
    spawnMesh(app, pbr);
    const cam = app.world.spawn(...Camera3d(), new DepthPrepass(), new ScreenSpaceAo());
    await app.run();

    expect(log.passes.find((p) => p.label?.endsWith('.ao-gtao'))).toBeUndefined();
    expect(app.getResource(ViewAoTargets)!.perCamera.get(cam)).toBeUndefined();
  });

  it('allocates the temporal history + runs the temporal pass when a MotionVectorPrepass is present', async () => {
    const { app, pbr, log } = buildApp();
    spawnMesh(app, pbr);
    const cam = app.world.spawn(
      ...Camera3d({ hdr: true }),
      new DepthPrepass(),
      new NormalPrepass(),
      new MotionVectorPrepass(),
      new ScreenSpaceAo(),
    );
    await app.run();

    const entry = app.getResource(ViewAoTargets)!.perCamera.get(cam)!;
    expect(entry.historyTextures).toBeDefined();
    expect(entry.finalView).toBe(entry.historyViews![entry.current]);
    const pass = log.passes.find((p) => p.label?.endsWith('.ao-temporal'));
    expect(pass).toBeDefined();
    expect(pass!.drawCalls.filter((c) => c.kind === 'draw')).toHaveLength(1);
  });

  it('skips temporal (blur-only, no history) when no MotionVectorPrepass is present', async () => {
    const { app, pbr, log } = buildApp();
    spawnMesh(app, pbr);
    const cam = app.world.spawn(
      ...Camera3d({ hdr: true }),
      new DepthPrepass(),
      new NormalPrepass(),
      new ScreenSpaceAo(),
    );
    await app.run();

    const entry = app.getResource(ViewAoTargets)!.perCamera.get(cam)!;
    expect(entry.historyTextures).toBeUndefined();
    expect(entry.finalView).toBe(entry.blurredView);
    expect(log.passes.find((p) => p.label?.endsWith('.ao-temporal'))).toBeUndefined();
  });

  it('evicts then recreates the AO target across an off→on toggle', async () => {
    const { app, pbr } = buildApp();
    spawnMesh(app, pbr);
    const cam = app.world.spawn(
      ...Camera3d(),
      new DepthPrepass(),
      new NormalPrepass(),
      new ScreenSpaceAo(),
    );
    await app.run();
    const targets = app.getResource(ViewAoTargets)!;
    expect(targets.perCamera.get(cam)).toBeDefined();

    app.world.removeComponent(cam, ScreenSpaceAo);
    app.advanceFrame();
    expect(targets.perCamera.get(cam)).toBeUndefined();

    app.world.insertBundle(cam, [new ScreenSpaceAo()]);
    app.advanceFrame();
    expect(targets.perCamera.get(cam)).toBeDefined();
  });
});
