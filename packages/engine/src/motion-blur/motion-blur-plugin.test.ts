import { vec4 } from '@retro-engine/math';
import { describe, expect, it } from 'bun:test';

import {
  App,
  Camera3d,
  Core3dLabel,
  Cuboid,
  DepthPrepass,
  Light3dPlugin,
  MaterialPlugin,
  Mesh3d,
  Meshes,
  MotionBlur,
  MotionBlurPass3dLabel,
  MotionVectorPrepass,
  NormalPrepass,
  PrepassPlugin,
  RenderGraph,
  StandardMaterial,
  StandardMaterialPlugin,
  TonemappingPass3dLabel,
  TransparentPass3dLabel,
  ViewMotionBlur,
  ViewMotionBlurTargets,
} from '../index';
import { makeCapturingRenderer, makeStubCanvas } from '../test-utils';

/** App with the StandardMaterial + prepass plumbing motion blur depends on. */
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

describe('MotionBlur component', () => {
  it('defaults to 8 samples, full intensity, 180° shutter', () => {
    const mb = new MotionBlur();
    expect(mb.samples).toBe(8);
    expect(mb.intensity).toBe(1.0);
    expect(mb.shutterAngle).toBe(0.5);
    expect(mb.maxVelocity).toBe(0.1);
  });

  it('honors overrides', () => {
    const mb = new MotionBlur({ samples: 16, shutterAngle: 1, maxVelocity: 0.2 });
    expect(mb.samples).toBe(16);
    expect(mb.shutterAngle).toBe(1);
    expect(mb.maxVelocity).toBe(0.2);
    expect(mb.intensity).toBe(1.0);
  });
});

describe('MotionBlurPlugin (integration)', () => {
  it('orders the Core3d node Transparent → MotionBlur → Tonemapping', async () => {
    const { app } = buildApp();
    app.world.spawn(...Camera3d({ hdr: true }), new DepthPrepass(), new MotionVectorPrepass());
    await app.run();

    const sub = app.getResource(RenderGraph)!.getSubGraph(Core3dLabel)!;
    const ordered = sub.orderedNodes()!.map((n) => String(n.label));
    const t = ordered.indexOf(String(TransparentPass3dLabel));
    const mb = ordered.indexOf(String(MotionBlurPass3dLabel));
    const tm = ordered.indexOf(String(TonemappingPass3dLabel));
    expect(t).toBeGreaterThanOrEqual(0);
    expect(mb).toBeGreaterThan(t);
    expect(tm).toBeGreaterThan(mb);
  });

  it('runs the motion-blur fullscreen draw for an HDR camera with a motion target', async () => {
    const { app, pbr, log } = buildApp();
    spawnMesh(app, pbr);
    app.world.spawn(
      ...Camera3d({ hdr: true }),
      new DepthPrepass(),
      new NormalPrepass(),
      new MotionVectorPrepass(),
      new MotionBlur(),
    );
    await app.run();

    const pass = log.passes.find((p) => p.label?.endsWith('.motion-blur'));
    expect(pass).toBeDefined();
    const draws = pass!.drawCalls.filter((c) => c.kind === 'draw');
    expect(draws).toHaveLength(1);
    expect(draws[0]!.draw!.vertexCount).toBe(3);
  });

  it('allocates a per-camera output intermediate only when prerequisites are met', async () => {
    const { app, pbr } = buildApp();
    spawnMesh(app, pbr);
    const cam = app.world.spawn(
      ...Camera3d({ hdr: true }),
      new DepthPrepass(),
      new MotionVectorPrepass(),
      new MotionBlur(),
    );
    await app.run();

    const targets = app.getResource(ViewMotionBlurTargets)!;
    expect(targets.perCamera.get(cam)).toBeDefined();
  });

  it('extracts per-camera params with intensity×shutterAngle folded into velocityScale', async () => {
    const { app } = buildApp();
    const cam = app.world.spawn(
      ...Camera3d({ hdr: true }),
      new DepthPrepass(),
      new MotionVectorPrepass(),
      new MotionBlur({ samples: 12, intensity: 0.8, shutterAngle: 0.5, maxVelocity: 0.15 }),
    );
    await app.run();

    const params = app.getResource(ViewMotionBlur)!.byCamera.get(cam);
    expect(params).toBeDefined();
    expect(params!.samples).toBe(12);
    expect(params!.velocityScale).toBeCloseTo(0.4);
    expect(params!.maxVelocity).toBeCloseTo(0.15);
  });

  it('skips (no pass, no target) for an HDR camera with MotionBlur but no MotionVectorPrepass', async () => {
    const { app, pbr, log } = buildApp();
    spawnMesh(app, pbr);
    const cam = app.world.spawn(...Camera3d({ hdr: true }), new MotionBlur());
    await app.run();

    expect(log.passes.find((p) => p.label?.endsWith('.motion-blur'))).toBeUndefined();
    expect(app.getResource(ViewMotionBlurTargets)!.perCamera.get(cam)).toBeUndefined();
  });

  it('evicts then recreates the output target across an off→on toggle', async () => {
    const { app, pbr } = buildApp();
    spawnMesh(app, pbr);
    const cam = app.world.spawn(
      ...Camera3d({ hdr: true }),
      new DepthPrepass(),
      new MotionVectorPrepass(),
      new MotionBlur(),
    );
    await app.run();
    const targets = app.getResource(ViewMotionBlurTargets)!;
    expect(targets.perCamera.get(cam)).toBeDefined();

    // Toggle off: the prepare system evicts the target and invalidates the
    // pipeline's cached bind group (which referenced the now-destroyed buffer).
    app.world.removeComponent(cam, MotionBlur);
    app.advanceFrame();
    expect(targets.perCamera.get(cam)).toBeUndefined();

    // Toggle on: a fresh target + params buffer is allocated and the pass runs
    // again against it rather than a stale cached bind group.
    app.world.insertBundle(cam, [new MotionBlur()]);
    app.advanceFrame();
    expect(targets.perCamera.get(cam)).toBeDefined();
  });

  it('skips for a non-HDR camera even with MotionVectorPrepass + MotionBlur', async () => {
    const { app, pbr, log } = buildApp();
    spawnMesh(app, pbr);
    const cam = app.world.spawn(
      ...Camera3d(),
      new DepthPrepass(),
      new MotionVectorPrepass(),
      new MotionBlur(),
    );
    await app.run();

    expect(log.passes.find((p) => p.label?.endsWith('.motion-blur'))).toBeUndefined();
    expect(app.getResource(ViewMotionBlurTargets)!.perCamera.get(cam)).toBeUndefined();
  });
});
