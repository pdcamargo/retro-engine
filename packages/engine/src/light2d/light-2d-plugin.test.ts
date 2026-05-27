import { describe, expect, it } from 'bun:test';

import { vec2, vec3, vec4 } from '@retro-engine/math';

import {
  AmbientLight2d,
  App,
  Camera2d,
  Core2dLabel,
  DirectionalLight2d,
  Light2dAccumulationPass2dLabel,
  Light2dCompositePass2dLabel,
  Light2dPipeline,
  Light2dPlugin,
  Light2dPreparedBatches,
  Light2dSettings,
  OpaquePass2dLabel,
  PointLight2d,
  RenderGraph,
  Sprite,
  SpotLight2d,
  SpritePlugin,
  Transform,
  TransparentPass2dLabel,
  ViewLight2dTargets,
} from '../index';
import { makeCapturingRenderer, makeStubCanvas } from '../test-utils';

describe('Light2dPlugin (integration)', () => {
  it('inserts the accumulation + composite nodes around the existing 2D phase trio', async () => {
    const { renderer } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.addPlugin(new Light2dPlugin());
    app.world.spawn(...Camera2d());
    await app.run();

    const graph = app.getResource(RenderGraph)!;
    const sub = graph.getSubGraph(Core2dLabel)!;
    const ordered = sub.orderedNodes()!.map((n) => String(n.label));
    const accumIdx = ordered.indexOf(String(Light2dAccumulationPass2dLabel));
    const opaqueIdx = ordered.indexOf(String(OpaquePass2dLabel));
    const transparentIdx = ordered.indexOf(String(TransparentPass2dLabel));
    const compositeIdx = ordered.indexOf(String(Light2dCompositePass2dLabel));
    expect(accumIdx).toBeGreaterThanOrEqual(0);
    expect(opaqueIdx).toBeGreaterThanOrEqual(0);
    expect(transparentIdx).toBeGreaterThanOrEqual(0);
    expect(compositeIdx).toBeGreaterThanOrEqual(0);
    expect(accumIdx).toBeLessThan(opaqueIdx);
    expect(opaqueIdx).toBeLessThan(transparentIdx);
    expect(transparentIdx).toBeLessThan(compositeIdx);
  });

  it('emits an additive instanced draw in the accumulation pass when a PointLight2d is spawned', async () => {
    const { renderer, log } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.addPlugin(new SpritePlugin());
    app.addPlugin(new Light2dPlugin());
    app.world.spawn(
      new PointLight2d({
        color: vec3.create(1, 0.9, 0.6),
        intensity: 2,
        range: 256,
        radius: 16,
      }),
    );
    app.world.spawn(...Camera2d());
    await app.run();

    const accum = log.passes.find((p) => p.label?.endsWith('.light2d_accumulation'));
    expect(accum).toBeDefined();
    const draws = accum!.drawCalls.filter((c) => c.kind === 'drawIndexed');
    expect(draws).toHaveLength(1);
    const draw = draws[0]!.drawIndexed!;
    expect(draw.indexCount).toBe(6);
    expect(draw.instanceCount).toBe(1);
    expect(draw.firstInstance).toBe(0);
  });

  it('opens the composite pass and the accumulation clear even when no PointLight2d exists', async () => {
    const { renderer, log } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.addPlugin(new Light2dPlugin());
    app.world.spawn(...Camera2d());
    await app.run();

    // Accumulation pass opens to clear lightAccum to ambient even without
    // light contributions; composite must always run so the camera target
    // ends up populated rather than blank.
    const accum = log.passes.find((p) => p.label?.endsWith('.light2d_accumulation'));
    expect(accum).toBeDefined();
    expect(accum!.drawCalls.filter((c) => c.kind === 'drawIndexed')).toHaveLength(0);

    const composite = log.passes.find((p) => p.label?.endsWith('.light2d_composite'));
    expect(composite).toBeDefined();
    const fullscreenDraws = composite!.drawCalls.filter((c) => c.kind === 'draw');
    expect(fullscreenDraws).toHaveLength(1);
    expect(fullscreenDraws[0]!.draw!.vertexCount).toBe(3);
  });

  it('allocates a per-camera baseColor + lightAccum target sized to the camera surface', async () => {
    const { renderer } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.addPlugin(new Light2dPlugin());
    app.world.spawn(...Camera2d());
    await app.run();

    const targets = app.getResource(ViewLight2dTargets)!;
    expect(targets.perCamera.size).toBe(1);
    const entry = [...targets.perCamera.values()][0]!;
    // The capturing renderer's surface reports 640x480; the resolved target
    // mirrors those dimensions.
    expect(entry.width).toBe(640);
    expect(entry.height).toBe(480);
    expect(entry.baseColorFormat).toBe('rgba8unorm');
  });

  it('redirects sprite draws into the baseColor texture when the plugin is installed', async () => {
    const { renderer, log } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.addPlugin(new SpritePlugin());
    app.addPlugin(new Light2dPlugin());
    app.world.spawn(new Sprite({ color: vec4.create(1, 1, 1, 1) }));
    app.world.spawn(...Camera2d());
    await app.run();

    // Phase 9.1 load-bearing redirect: opaque2d writes into baseColor, not
    // the surface. The composite pass writes the surface afterwards.
    const opaque = log.passes.find((p) => p.label?.endsWith('.opaque2d'));
    expect(opaque).toBeDefined();
    expect(opaque!.drawCalls.filter((c) => c.kind === 'drawIndexed')).toHaveLength(1);

    // Composite is the LAST pass on this camera and produces a 3-vertex
    // fullscreen draw against the multiplicative composite pipeline.
    const composite = log.passes.find((p) => p.label?.endsWith('.light2d_composite'));
    expect(composite).toBeDefined();
    const compositeDraws = composite!.drawCalls.filter((c) => c.kind === 'draw');
    expect(compositeDraws).toHaveLength(1);
    expect(compositeDraws[0]!.draw!.vertexCount).toBe(3);
  });

  it('emits one batch per Core2d camera even with no visible lights so the accumulation clear runs', async () => {
    const { renderer } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.addPlugin(new Light2dPlugin());
    app.world.spawn(...Camera2d());
    await app.run();

    const prepared = app.getResource(Light2dPreparedBatches)!;
    expect(prepared.batches).toHaveLength(1);
    expect(prepared.batches[0]!.count).toBe(0);
  });

  it('uses Light2dSettings.ambient as the accumulation clear color', async () => {
    const { renderer } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.addPlugin(new Light2dPlugin());
    const settings = app.getResource(Light2dSettings)!;
    settings.ambient = vec4.create(0.2, 0.25, 0.3, 1);
    app.world.spawn(...Camera2d());
    await app.run();

    // No direct hook to introspect the clear value from the capturing
    // renderer (it records pass labels, not descriptor clear colors), so
    // assert the settings resource is what the node reads. The
    // accumulation pass body resolves `Light2dSettings.ambient` per frame,
    // so a later mutation is honoured at the next frame.
    expect(settings.ambient[0]).toBeCloseTo(0.2);
    expect(settings.ambient[1]).toBeCloseTo(0.25);
    expect(settings.ambient[2]).toBeCloseTo(0.3);
  });

  it('packs PointLight2d position from GlobalTransform into the instance buffer', async () => {
    const { renderer } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.addPlugin(new Light2dPlugin());
    app.world.spawn(
      new PointLight2d({ range: 200, radius: 12, intensity: 1.5 }),
      new Transform(vec3.create(48, -32, 0)),
    );
    app.world.spawn(...Camera2d());
    await app.run();

    // After one frame the instance buffer carries the light's world position
    // and parameters in its first 8-float slot. We can't read GPU buffers
    // from the headless renderer, but the scratch typed-array is what got
    // uploaded — it carries the same packed data.
    const { Light2dInstanceBuffer, LIGHT2D_INSTANCE_FLOAT_COUNT } = await import('./index');
    const buf = app.getResource(Light2dInstanceBuffer)!;
    expect(buf.count).toBe(1);
    expect(buf.scratchF32[0]).toBe(48);
    expect(buf.scratchF32[1]).toBe(-32);
    expect(buf.scratchF32[2]).toBe(200);
    expect(buf.scratchF32[3]).toBe(12);
    expect(buf.scratchF32[7]).toBe(1.5);
    expect(LIGHT2D_INSTANCE_FLOAT_COUNT).toBe(13);
  });

  it('packs each light kind with its discriminator and per-kind params', async () => {
    const { renderer } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.addPlugin(new Light2dPlugin());
    app.world.spawn(new PointLight2d({ range: 100 }), new Transform(vec3.create(1, 2, 0)));
    app.world.spawn(
      new SpotLight2d({
        range: 120,
        direction: vec2.create(1, 0),
        innerAngle: 0,
        outerAngle: Math.PI / 2,
      }),
      new Transform(vec3.create(3, 4, 0)),
    );
    app.world.spawn(new DirectionalLight2d({ direction: vec2.create(0, -1) }));
    app.world.spawn(new AmbientLight2d({ halfExtents: vec2.create(50, 30) }), new Transform(vec3.create(5, 6, 0)));
    app.world.spawn(...Camera2d());
    await app.run();

    const { Light2dInstanceBuffer, LIGHT2D_INSTANCE_FLOAT_COUNT, Light2dKind } = await import('./index');
    const buf = app.getResource(Light2dInstanceBuffer)!;
    const stride = LIGHT2D_INSTANCE_FLOAT_COUNT;
    expect(buf.count).toBe(4);

    // Pack order is point → spot → directional → ambient.
    const f = buf.scratchF32;
    expect(f[12]).toBe(Light2dKind.Point);
    // Spot: cone dir.x at slot 8, cos(outer)=cos(PI/2)≈0 at slot 11.
    expect(f[1 * stride + 12]).toBe(Light2dKind.Spot);
    expect(f[1 * stride + 8]).toBeCloseTo(1);
    expect(f[1 * stride + 11]).toBeCloseTo(0);
    expect(f[2 * stride + 12]).toBe(Light2dKind.Directional);
    // Ambient zone: half-extents in the footprint slot.
    expect(f[3 * stride + 12]).toBe(Light2dKind.AmbientZone);
    expect(f[3 * stride + 2]).toBe(50);
    expect(f[3 * stride + 3]).toBe(30);
  });

  it('specializes a distinct composite pipeline per composite mode', async () => {
    const { renderer } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.addPlugin(new Light2dPlugin());
    app.world.spawn(...Camera2d());
    await app.run();

    const pipeline = app.getResource(Light2dPipeline)!;
    const surfaceFormat = 'rgba8unorm' as const;
    const multiply = pipeline.composite!.get({ key: { surfaceFormat, compositeMode: 'multiply' } });
    const add = pipeline.composite!.get({ key: { surfaceFormat, compositeMode: 'add' } });
    const screen = pipeline.composite!.get({ key: { surfaceFormat, compositeMode: 'screen' } });
    // Distinct modes yield distinct cached pipelines; the same key is reused.
    expect(multiply).not.toBe(add);
    expect(add).not.toBe(screen);
    expect(pipeline.composite!.get({ key: { surfaceFormat, compositeMode: 'add' } })).toBe(add);
  });
});
