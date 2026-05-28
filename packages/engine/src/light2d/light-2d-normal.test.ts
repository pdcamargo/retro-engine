import { describe, expect, it } from 'bun:test';

import { vec2, vec3, vec4 } from '@retro-engine/math';

import {
  App,
  Camera2d,
  Commands,
  Core2dLabel,
  Image,
  Images,
  Light2dAccumulationPass2dLabel,
  Light2dNormalPrepass2dLabel,
  Light2dNormalState,
  Light2dPlugin,
  Light2dSettings,
  Light2dShadowPass2dLabel,
  RenderGraph,
  ResMut,
  Sprite,
  SpritePlugin,
  Transform,
  ViewLight2dTargets,
} from '../index';
import { makeCapturingRenderer, makeStubCanvas } from '../test-utils';

describe('Light2dPlugin normal mapping (integration)', () => {
  it('orders the normal prepass before the shadow + accumulation passes', async () => {
    const { renderer } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.addPlugin(new Light2dPlugin());
    app.world.spawn(...Camera2d());
    await app.run();

    const sub = app.getResource(RenderGraph)!.getSubGraph(Core2dLabel)!;
    const ordered = sub.orderedNodes()!.map((n) => String(n.label));
    const normalIdx = ordered.indexOf(String(Light2dNormalPrepass2dLabel));
    const shadowIdx = ordered.indexOf(String(Light2dShadowPass2dLabel));
    const accumIdx = ordered.indexOf(String(Light2dAccumulationPass2dLabel));
    expect(normalIdx).toBeGreaterThanOrEqual(0);
    expect(normalIdx).toBeLessThan(shadowIdx);
    expect(shadowIdx).toBeLessThan(accumIdx);
  });

  it('allocates a per-camera normal target and the accumulation @group(2) bind group', async () => {
    const { renderer } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.addPlugin(new Light2dPlugin());
    app.world.spawn(...Camera2d());
    await app.run();

    const entry = [...app.getResource(ViewLight2dTargets)!.perCamera.values()][0]!;
    expect(entry.normalTex).toBeDefined();
    expect(entry.normalView).toBeDefined();
    expect(entry.normalAccumBindGroup).toBeDefined();

    // Normal resources (sampler + uniform) are created sprite-independently.
    const normal = app.getResource(Light2dNormalState)!;
    expect(normal.sampler).toBeDefined();
    expect(normal.uniformBuffer).toBeDefined();
  });

  it('captures a normal-mapped sprite when normalMapping is enabled', async () => {
    const { renderer } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.addPlugin(new SpritePlugin());
    app.addPlugin(new Light2dPlugin());
    app.addSystem('startup', [Commands, ResMut(Images), ResMut(Light2dSettings)], (cmd, images, settings) => {
      (settings as Light2dSettings).normalMapping = true;
      const nm = (images as Images).add(Image.solid(vec4.create(0.5, 0.5, 1, 1), { colorSpace: 'linear' }));
      cmd.spawn(
        new Sprite({ normalMap: nm, customSize: vec2.create(32, 32) }),
        new Transform(vec3.create(0, 0, 0)),
      );
      cmd.spawn(...Camera2d());
    });
    await app.run();

    const normal = app.getResource(Light2dNormalState)!;
    expect(normal.enabled).toBe(true);
    expect(normal.draws).toHaveLength(1);
    expect(normal.draws[0]!.count).toBe(1);
  });

  it('captures nothing when normalMapping is disabled (default)', async () => {
    const { renderer } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.addPlugin(new SpritePlugin());
    app.addPlugin(new Light2dPlugin());
    app.addSystem('startup', [Commands, ResMut(Images)], (cmd, images) => {
      const nm = (images as Images).add(Image.solid(vec4.create(0.5, 0.5, 1, 1), { colorSpace: 'linear' }));
      cmd.spawn(new Sprite({ normalMap: nm, customSize: vec2.create(32, 32) }));
      cmd.spawn(...Camera2d());
    });
    await app.run();

    const normal = app.getResource(Light2dNormalState)!;
    expect(normal.enabled).toBe(false);
    expect(normal.draws).toHaveLength(0);
  });
});
