import { describe, expect, it } from 'bun:test';

import { vec2, vec3 } from '@retro-engine/math';

import {
  App,
  Camera2d,
  Core2dLabel,
  Light2dAccumulationPass2dLabel,
  Light2dInstanceBuffer,
  Light2dPlugin,
  Light2dShadowPass2dLabel,
  Light2dShadowState,
  LightOccluder2d,
  PointLight2d,
  RenderGraph,
  Transform,
} from '../index';
import { makeCapturingRenderer, makeStubCanvas } from '../test-utils';

describe('Light2dPlugin shadows (integration)', () => {
  it('inserts the shadow-build node ordered before accumulation', async () => {
    const { renderer } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.addPlugin(new Light2dPlugin());
    app.world.spawn(...Camera2d());
    await app.run();

    const sub = app.getResource(RenderGraph)!.getSubGraph(Core2dLabel)!;
    const ordered = sub.orderedNodes()!.map((n) => String(n.label));
    const shadowIdx = ordered.indexOf(String(Light2dShadowPass2dLabel));
    const accumIdx = ordered.indexOf(String(Light2dAccumulationPass2dLabel));
    expect(shadowIdx).toBeGreaterThanOrEqual(0);
    expect(shadowIdx).toBeLessThan(accumIdx);
  });

  it('inserts a Light2dShadowState resource and allocates the atlas', async () => {
    const { renderer } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.addPlugin(new Light2dPlugin());
    app.world.spawn(...Camera2d());
    await app.run();

    const shadow = app.getResource(Light2dShadowState)!;
    expect(shadow.atlasTexture).toBeDefined();
    expect(shadow.accumBindGroup).toBeDefined();
  });

  it('packs occluder world-space segments and assigns the caster an atlas row', async () => {
    const { renderer } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.addPlugin(new Light2dPlugin());
    // Single segment, occluder translated to (100, 0): local (-10,-10)->(10,-10)
    // becomes world (90,-10)->(110,-10).
    app.world.spawn(
      new LightOccluder2d({ segments: [[vec2.create(-10, -10), vec2.create(10, -10)]] }),
      new Transform(vec3.create(100, 0, 0)),
    );
    app.world.spawn(new PointLight2d({ range: 200 }), new Transform(vec3.create(0, 0, 0)));
    app.world.spawn(...Camera2d());
    await app.run();

    const shadow = app.getResource(Light2dShadowState)!;
    expect(shadow.occluderCount).toBe(1);
    expect(shadow.casterCount).toBe(1);
    // Counts header.
    expect(shadow.scratch[0]).toBe(1);
    expect(shadow.scratch[1]).toBe(1);
    // Segment world coords at offset 4.
    expect(shadow.scratch[4]).toBe(90);
    expect(shadow.scratch[5]).toBe(-10);
    expect(shadow.scratch[6]).toBe(110);
    expect(shadow.scratch[7]).toBe(-10);

    // The point light's instance carries shadow row 0 (slot 13 of its instance).
    const buf = app.getResource(Light2dInstanceBuffer)!;
    expect(buf.scratchF32[13]).toBe(0);
  });

  it('renders the shadow-atlas build pass when a caster is present', async () => {
    const { renderer, log } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.addPlugin(new Light2dPlugin());
    app.world.spawn(LightOccluder2d.rect(20, 20), new Transform(vec3.create(80, 0, 0)));
    app.world.spawn(new PointLight2d({ range: 200 }), new Transform(vec3.create(0, 0, 0)));
    app.world.spawn(...Camera2d());
    await app.run();

    const build = log.passes.find((p) => p.label === 'light2d_shadow_atlas');
    expect(build).toBeDefined();
    const fullscreen = build!.drawCalls.filter((c) => c.kind === 'draw');
    expect(fullscreen).toHaveLength(1);
    expect(fullscreen[0]!.draw!.vertexCount).toBe(3);
  });

  it('skips the shadow-atlas build pass when no positional light exists', async () => {
    const { renderer, log } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.addPlugin(new Light2dPlugin());
    app.world.spawn(LightOccluder2d.rect(20, 20));
    app.world.spawn(...Camera2d());
    await app.run();

    expect(log.passes.find((p) => p.label === 'light2d_shadow_atlas')).toBeUndefined();
  });
});
