import { describe, expect, it } from 'bun:test';

import { App } from '../index';
import { makeHeadlessRenderer } from '../test-utils';
import { GlobalTransform, Transform } from '../transform';
import { AnimationClip } from './animation-clip';
import { AnimationClips } from './animation-clip-asset';
import { AnimationPlayer, AnimationTarget } from './animation-player';
import { advancePlayerTime } from './animation-system';
import { MorphWeights } from '../morph/morph-weights';

const near = (a: number, b: number, eps = 1e-4): boolean => Math.abs(a - b) <= eps;

/** A clip translating its target from origin to `(10,0,0)` over one second. */
const slideClip = (): AnimationClip =>
  new AnimationClip(
    [
      {
        target: { targetId: 'bone', component: 'Transform', path: [{ kind: 'field', name: 'translation' }] },
        sampler: {
          times: new Float32Array([0, 1]),
          values: new Float32Array([0, 0, 0, 10, 0, 0]),
          componentCount: 3,
          interpolation: 'LINEAR',
        },
      },
    ],
    1,
  );

describe('advancePlayerTime', () => {
  it('wraps a looping cursor and clamps a one-shot', () => {
    expect(advancePlayerTime(0.9, 0.3, 1, 'loop').time).toBeCloseTo(0.2, 5);
    const once = advancePlayerTime(0.9, 0.3, 1, 'once');
    expect(once.time).toBe(1);
    expect(once.playing).toBe(false);
  });

  it('treats a negative cursor under loop as wrapping from the end', () => {
    expect(advancePlayerTime(0.1, -0.3, 1, 'loop').time).toBeCloseTo(0.8, 5);
  });
});

describe('animation sampling system', () => {
  it('drives a bound entity Transform over time, before propagation', async () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const clips = app.getResource(AnimationClips)!;
    const handle = clips.add(slideClip());

    const player = app.world.spawn(new AnimationPlayer(handle, 1, true, 'loop'));
    const target = app.world.spawn(
      new Transform(),
      new GlobalTransform(),
      new AnimationTarget('bone', player),
    );

    // First frame establishes the clock with zero delta (cursor stays at 0).
    app.advanceFrame(0);
    let t = app.world.getComponent(target, Transform)!;
    expect(near(t.translation[0]!, 0)).toBe(true);

    // Advance ~0.5s in 100ms steps (the per-frame delta cap), then check the
    // interpolated translation and that propagation consumed it.
    for (let ms = 100; ms <= 500; ms += 100) app.advanceFrame(ms);
    t = app.world.getComponent(target, Transform)!;
    expect(near(t.translation[0]!, 5)).toBe(true);

    const g = app.world.getComponent(target, GlobalTransform)!;
    // Column-major: translation lands in matrix[12].
    expect(near(g.matrix[12]!, 5)).toBe(true);
  });

  it('drives a MorphWeights array over time', async () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const clips = app.getResource(AnimationClips)!;
    // Two targets: target 0 ramps 0→1, target 1 holds 0→0.5, over one second.
    const clip = new AnimationClip(
      [
        {
          target: { targetId: 'face', component: 'MorphWeights', path: [{ kind: 'field', name: 'weights' }] },
          sampler: {
            times: new Float32Array([0, 1]),
            values: new Float32Array([0, 0, 1, 0.5]),
            componentCount: 2,
            interpolation: 'LINEAR',
          },
        },
      ],
      1,
    );
    const handle = clips.add(clip);

    const player = app.world.spawn(new AnimationPlayer(handle, 1, true, 'loop'));
    const target = app.world.spawn(
      new MorphWeights(['a', 'b'], [0, 0]),
      new AnimationTarget('face', player),
    );

    app.advanceFrame(0);
    for (let ms = 100; ms <= 500; ms += 100) app.advanceFrame(ms);
    const mw = app.world.getComponent(target, MorphWeights)!;
    expect(near(mw.weights[0]!, 0.5)).toBe(true);
    expect(near(mw.weights[1]!, 0.25)).toBe(true);
  });

  it('ignores a stopped player', async () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const clips = app.getResource(AnimationClips)!;
    const handle = clips.add(slideClip());
    const player = app.world.spawn(new AnimationPlayer(handle, 1, false, 'loop'));
    const target = app.world.spawn(new Transform(), new AnimationTarget('bone', player));

    app.advanceFrame(0);
    for (let ms = 100; ms <= 500; ms += 100) app.advanceFrame(ms);
    const t = app.world.getComponent(target, Transform)!;
    // Stopped at time 0 → holds the first keyframe (origin).
    expect(near(t.translation[0]!, 0)).toBe(true);
  });
});
