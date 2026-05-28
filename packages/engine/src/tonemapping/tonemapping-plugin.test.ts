import { describe, expect, it } from 'bun:test';

import {
  App,
  Camera2d,
  Camera3d,
  Core2dLabel,
  Core3dLabel,
  Light2dCompositePass2dLabel,
  Light2dPlugin,
  RenderGraph,
  Tonemapping,
  TonemappingPass2dLabel,
  TonemappingPass3dLabel,
  TonemappingPipeline,
  TransparentPass2dLabel,
  TransparentPass3dLabel,
  ViewHdrTargets,
  ViewTonemapping,
} from '../index';
import { makeCapturingRenderer, makeStubCanvas } from '../test-utils';

describe('TonemappingPlugin (integration)', () => {
  it('auto-installs and inserts the Core2d tonemap node after the transparent pass', async () => {
    const { renderer } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.world.spawn(...Camera2d());
    await app.run();

    const graph = app.getResource(RenderGraph)!;
    const sub = graph.getSubGraph(Core2dLabel)!;
    const ordered = sub.orderedNodes()!.map((n) => String(n.label));
    const transparentIdx = ordered.indexOf(String(TransparentPass2dLabel));
    const tonemapIdx = ordered.indexOf(String(TonemappingPass2dLabel));
    expect(transparentIdx).toBeGreaterThanOrEqual(0);
    expect(tonemapIdx).toBeGreaterThanOrEqual(0);
    expect(transparentIdx).toBeLessThan(tonemapIdx);
  });

  it('inserts the Core3d tonemap node after the transparent pass', async () => {
    const { renderer } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.world.spawn(...Camera3d());
    await app.run();

    const graph = app.getResource(RenderGraph)!;
    const sub = graph.getSubGraph(Core3dLabel)!;
    const ordered = sub.orderedNodes()!.map((n) => String(n.label));
    const transparentIdx = ordered.indexOf(String(TransparentPass3dLabel));
    const tonemapIdx = ordered.indexOf(String(TonemappingPass3dLabel));
    expect(transparentIdx).toBeGreaterThanOrEqual(0);
    expect(tonemapIdx).toBeGreaterThanOrEqual(0);
    expect(transparentIdx).toBeLessThan(tonemapIdx);
  });

  it('orders Core2d tonemap after the Light2d composite when the light plugin is installed', async () => {
    const { renderer } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.addPlugin(new Light2dPlugin());
    app.world.spawn(...Camera2d());
    await app.run();

    const graph = app.getResource(RenderGraph)!;
    const sub = graph.getSubGraph(Core2dLabel)!;
    const ordered = sub.orderedNodes()!.map((n) => String(n.label));
    const compositeIdx = ordered.indexOf(String(Light2dCompositePass2dLabel));
    const tonemapIdx = ordered.indexOf(String(TonemappingPass2dLabel));
    expect(compositeIdx).toBeGreaterThanOrEqual(0);
    expect(tonemapIdx).toBeGreaterThanOrEqual(0);
    expect(compositeIdx).toBeLessThan(tonemapIdx);
  });

  it('skips the tonemap pass for non-HDR cameras', async () => {
    const { renderer, log } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.world.spawn(...Camera2d());
    await app.run();

    const tonemapPasses = log.passes.filter((p) => p.label?.endsWith('.tonemapping'));
    expect(tonemapPasses).toHaveLength(0);
  });

  it('runs the tonemap fullscreen draw for an HDR camera', async () => {
    const { renderer, log } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.world.spawn(...Camera3d({ hdr: true }));
    await app.run();

    const tonemap = log.passes.find((p) => p.label?.endsWith('.tonemapping'));
    expect(tonemap).toBeDefined();
    const draws = tonemap!.drawCalls.filter((c) => c.kind === 'draw');
    expect(draws).toHaveLength(1);
    expect(draws[0]!.draw!.vertexCount).toBe(3);
    expect(draws[0]!.draw!.instanceCount).toBe(1);
  });

  it('skips when the camera has hdr: true but no Tonemapping component (explicit opt-out)', async () => {
    const { renderer, log } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.world.spawn(...Camera3d({ hdr: true, tonemapping: false }));
    await app.run();

    const tonemap = log.passes.find((p) => p.label?.endsWith('.tonemapping'));
    expect(tonemap).toBeUndefined();
  });

  it('extracts the per-camera tonemap method into ViewTonemapping', async () => {
    const { renderer } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    const cam = app.world.spawn(...Camera3d({ hdr: true, tonemapping: 'reinhard' }));
    await app.run();

    const viewTm = app.getResource(ViewTonemapping)!;
    expect(viewTm.byCamera.get(cam)).toBe('reinhard');
  });

  it('produces one cached pipeline entry per (format, method) pair', async () => {
    const { renderer } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.world.spawn(...Camera3d({ hdr: true, tonemapping: 'aces_fitted' }));
    await app.run();

    const pipeline = app.getResource(TonemappingPipeline)!;
    expect(pipeline.specialized).toBeDefined();
    expect(pipeline.specialized!.keyCount).toBe(1);

    // Spawn a second HDR camera with a different operator; the second
    // frame should add one more cache entry, not replace the first.
    app.world.spawn(
      ...Camera3d({ hdr: true, tonemapping: 'reinhard' }),
      new Tonemapping({ method: 'reinhard' }),
    );
    app.advanceFrame();
    expect(pipeline.specialized!.keyCount).toBeGreaterThanOrEqual(2);
  });

  it('allocates an rgba16float HDR intermediate for HDR cameras only', async () => {
    const { renderer } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    const hdrCam = app.world.spawn(...Camera3d({ hdr: true }));
    const ldrCam = app.world.spawn(...Camera2d());
    await app.run();

    const hdrTargets = app.getResource(ViewHdrTargets)!;
    const hdrEntry = hdrTargets.perCamera.get(hdrCam);
    expect(hdrEntry).toBeDefined();
    expect(hdrEntry!.format).toBe('rgba16float');
    expect(hdrTargets.perCamera.get(ldrCam)).toBeUndefined();
  });
});
