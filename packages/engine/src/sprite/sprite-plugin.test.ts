import { describe, expect, it } from 'bun:test';

import { vec2, vec3, vec4 } from '@retro-engine/math';

import {
  App,
  Camera2d,
  Image,
  Images,
  SPRITE_INSTANCE_FLOAT_COUNT,
  Sprite,
  SpriteInstanceBuffer,
  SpritePlugin,
  Transform,
} from '../index';
import { makeCapturingRenderer, makeStubCanvas } from '../test-utils';

describe('SpritePlugin (integration)', () => {
  it('emits one instanced draw per (image, alphaBucket) batch into the opaque2d pass', async () => {
    const { renderer, log } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.addPlugin(new SpritePlugin());

    const images = app.getResource(Images)!;
    const imageA = images.add(Image.solid(vec4.create(1, 0, 0, 1), { label: 'A' }));
    const imageB = images.add(Image.solid(vec4.create(0, 1, 0, 1), { label: 'B' }));

    // Spawn 5 sprites using imageA, 5 using the default fallback (Images.WHITE).
    for (let i = 0; i < 5; i++) {
      app.world.spawn(
        new Sprite({
          image: imageA,
          color: vec4.create(1, 1, 1, 1),
          customSize: vec2.create(8, 8),
        }),
      );
    }
    for (let i = 0; i < 5; i++) {
      app.world.spawn(
        new Sprite({
          color: vec4.create(0.5, 0.5, 0.5, 1),
          customSize: vec2.create(8, 8),
        }),
      );
    }
    // Reference imageB so the lint/dead-code path doesn't strip the asset —
    // also exercises the third bind-group cache slot for completeness.
    app.world.spawn(
      new Sprite({
        image: imageB,
        color: vec4.create(1, 1, 1, 1),
        customSize: vec2.create(8, 8),
      }),
    );
    app.world.spawn(...Camera2d());

    await app.run();

    const opaque = log.passes.find((p) => p.label?.endsWith('.opaque2d'));
    expect(opaque).toBeDefined();
    const drawIndexed = opaque!.drawCalls.filter((c) => c.kind === 'drawIndexed');
    // Three batches: (imageA, opaque), (Images.WHITE, opaque), (imageB, opaque).
    expect(drawIndexed).toHaveLength(3);
    // The two largest batches carry 5 instances each; the imageB batch has 1.
    const counts = drawIndexed
      .map((c) => c.drawIndexed!.instanceCount)
      .sort((a, b) => a - b);
    expect(counts).toEqual([1, 5, 5]);

    // Each draw is preceded by a `setBindGroup(1, ...)` that distinguishes
    // the per-image binding. Collect the bind-group objects bound at
    // `@group(1)` in order and assert all three are distinct identities.
    const group1Binds = opaque!.drawCalls
      .filter((c) => c.kind === 'setBindGroup' && c.bindGroup?.index === 1)
      .map((c) => c.bindGroup!.group);
    expect(group1Binds).toHaveLength(3);
    const distinct = new Set(group1Binds);
    expect(distinct.size).toBe(3);
  });

  it('opens the transparent2d pass only when transparent batches exist', async () => {
    const { renderer, log } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.addPlugin(new SpritePlugin());

    // One transparent sprite (tint alpha < 1) → goes to the transparent
    // bucket; the transparent2d pass should open.
    app.world.spawn(
      new Sprite({
        color: vec4.create(1, 1, 1, 0.5),
        customSize: vec2.create(16, 16),
      }),
    );
    app.world.spawn(...Camera2d());

    await app.run();

    const transparent = log.passes.find((p) => p.label?.endsWith('.transparent2d'));
    expect(transparent).toBeDefined();
    const drawIndexed = transparent!.drawCalls.filter((c) => c.kind === 'drawIndexed');
    expect(drawIndexed).toHaveLength(1);
    expect(drawIndexed[0]!.drawIndexed!.instanceCount).toBe(1);
  });

  it('orders batches back-to-front when same-image sprites surround a foreign-image sprite at intermediate Z', async () => {
    const { renderer, log } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.addPlugin(new SpritePlugin());

    const images = app.getResource(Images)!;
    const imageA = images.add(Image.solid(vec4.create(1, 0, 0, 1), { label: 'A' }));
    const imageB = images.add(Image.solid(vec4.create(0, 1, 0, 1), { label: 'B' }));

    // A@Z=10, B@Z=5, A@Z=0. Back-to-front sort emits batches in [A, B, A]
    // sequence — the imageB sprite at intermediate Z breaks the imageA run.
    app.world.spawn(
      new Sprite({
        image: imageA,
        color: vec4.create(1, 1, 1, 1),
        customSize: vec2.create(8, 8),
      }),
      new Transform(vec3.create(0, 0, 10)),
    );
    app.world.spawn(
      new Sprite({
        image: imageB,
        color: vec4.create(1, 1, 1, 1),
        customSize: vec2.create(8, 8),
      }),
      new Transform(vec3.create(0, 0, 5)),
    );
    app.world.spawn(
      new Sprite({
        image: imageA,
        color: vec4.create(1, 1, 1, 1),
        customSize: vec2.create(8, 8),
      }),
      new Transform(vec3.create(0, 0, 0)),
    );
    app.world.spawn(...Camera2d());

    await app.run();

    const opaque = log.passes.find((p) => p.label?.endsWith('.opaque2d'));
    expect(opaque).toBeDefined();
    const drawIndexed = opaque!.drawCalls.filter((c) => c.kind === 'drawIndexed');
    expect(drawIndexed).toHaveLength(3);
    for (const draw of drawIndexed) {
      expect(draw.drawIndexed!.instanceCount).toBe(1);
    }

    // Each draw is preceded by a `setBindGroup(1, ...)`. Walk the pass calls
    // in order and verify the bind-group identity sequence matches [A, B, A]
    // — same handle for the outer two, distinct handle for the middle.
    const group1Binds = opaque!.drawCalls
      .filter((c) => c.kind === 'setBindGroup' && c.bindGroup?.index === 1)
      .map((c) => c.bindGroup!.group);
    expect(group1Binds).toHaveLength(3);
    expect(group1Binds[0]).toBe(group1Binds[2]);
    expect(group1Binds[0]).not.toBe(group1Binds[1]);
  });

  it('collapses same-image sprites at varying Z into one batch ordered back-to-front', async () => {
    const { renderer } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.addPlugin(new SpritePlugin());

    const images = app.getResource(Images)!;
    const imageA = images.add(Image.solid(vec4.create(1, 1, 1, 1), { label: 'A' }));

    // Five sprites of one image at distinct Z values, each carrying a unique
    // red byte so the packed RGBA in the instance scratch is the per-sprite
    // discriminator we can read back to verify within-batch order.
    // R = 0.2, 0.4, 0.6, 0.8, 1.0 packs to bytes 51, 102, 153, 204, 255.
    const reds = [0.2, 0.4, 0.6, 0.8, 1.0];
    for (let i = 0; i < 5; i++) {
      app.world.spawn(
        new Sprite({
          image: imageA,
          color: vec4.create(reds[i]!, 0, 0, 1),
          customSize: vec2.create(8, 8),
        }),
        new Transform(vec3.create(0, 0, i)),
      );
    }
    app.world.spawn(...Camera2d());

    await app.run();

    const instanceBuffer = app.getResource(SpriteInstanceBuffer)!;
    expect(instanceBuffer.count).toBe(5);

    // Z = 4 sprite (R=1.0 → 255) sits at instance 0, Z = 0 (R=0.2 → 51) at
    // instance 4 — back-to-front in scratch matches the painter order the
    // Core2d phase nodes expect.
    const expectedRBytes = [255, 204, 153, 102, 51];
    for (let i = 0; i < 5; i++) {
      const packed = instanceBuffer.scratchU32[i * SPRITE_INSTANCE_FLOAT_COUNT + 10]!;
      const r = packed & 0xff;
      expect(r).toBe(expectedRBytes[i]!);
    }
  });

  it('emits one batch per image when two images render at the same Z (regression)', async () => {
    const { renderer, log } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.addPlugin(new SpritePlugin());

    const images = app.getResource(Images)!;
    const imageA = images.add(Image.solid(vec4.create(1, 0, 0, 1), { label: 'A' }));
    const imageB = images.add(Image.solid(vec4.create(0, 1, 0, 1), { label: 'B' }));

    for (let i = 0; i < 3; i++) {
      app.world.spawn(
        new Sprite({
          image: imageA,
          color: vec4.create(1, 1, 1, 1),
          customSize: vec2.create(8, 8),
        }),
      );
    }
    for (let i = 0; i < 3; i++) {
      app.world.spawn(
        new Sprite({
          image: imageB,
          color: vec4.create(1, 1, 1, 1),
          customSize: vec2.create(8, 8),
        }),
      );
    }
    app.world.spawn(...Camera2d());

    await app.run();

    const opaque = log.passes.find((p) => p.label?.endsWith('.opaque2d'));
    expect(opaque).toBeDefined();
    const drawIndexed = opaque!.drawCalls.filter((c) => c.kind === 'drawIndexed');
    expect(drawIndexed).toHaveLength(2);
    const counts = drawIndexed
      .map((c) => c.drawIndexed!.instanceCount)
      .sort((a, b) => a - b);
    expect(counts).toEqual([3, 3]);
  });

  it('opens an empty opaque2d pass and skips the transparent2d pass when no sprites are spawned', async () => {
    const { renderer, log } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.addPlugin(new SpritePlugin());
    app.world.spawn(...Camera2d());

    await app.run();

    // The opaque pass always opens (it owns the camera clear); the
    // transparent pass short-circuits when there are no items.
    const opaque = log.passes.find((p) => p.label?.endsWith('.opaque2d'));
    expect(opaque).toBeDefined();
    expect(opaque!.drawCalls.filter((c) => c.kind === 'drawIndexed')).toHaveLength(0);
    const transparent = log.passes.find((p) => p.label?.endsWith('.transparent2d'));
    expect(transparent).toBeUndefined();
  });
});
