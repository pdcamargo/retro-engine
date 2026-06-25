import { describe, expect, it } from 'bun:test';

import type { Handle } from '@retro-engine/assets';

import { App } from '../index';
import { makeHeadlessRenderer } from '../test-utils';
import { Transform } from '../transform';
import { AnimationClip } from './animation-clip';
import { AnimationClips } from './animation-clip-asset';
import { AnimationLayers, type AnimationLayer } from './animation-layers';
import { AnimationTarget } from './animation-player';
import { AvatarMask } from './avatar-mask';
import { AvatarMasks } from './avatar-mask-asset';

const near = (a: number, b: number, eps = 1e-4): boolean => Math.abs(a - b) <= eps;

/** A constant clip translating `targetId` to `(x, 0, 0)`. */
const constClip = (targetId: string, x: number): AnimationClip =>
  new AnimationClip(
    [
      {
        target: { targetId, component: 'Transform', path: [{ kind: 'field', name: 'translation' }] },
        sampler: {
          times: new Float32Array([0]),
          values: new Float32Array([x, 0, 0]),
          componentCount: 3,
          interpolation: 'STEP',
        },
      },
    ],
    0,
  );

const clipLayer = (
  clip: Handle<AnimationClip>,
  blend: 'override' | 'additive',
  mask?: Handle<AvatarMask>,
): AnimationLayer => ({
  weight: 1,
  blend,
  mask,
  source: { kind: 'clip', clip, speed: 1, playing: true, repeat: 'loop' },
});

describe('layered animation', () => {
  it('masks an override layer to a subset of bones', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const clips = app.getResource(AnimationClips)!;
    const masks = app.getResource(AvatarMasks)!;

    // Base moves both bones to x=2; the upper layer wants both at x=10 but is
    // masked to bone "a" only.
    const base = clips.add(
      new AnimationClip([...constClip('a', 2).tracks, ...constClip('b', 2).tracks], 0),
    );
    const upper = clips.add(
      new AnimationClip([...constClip('a', 10).tracks, ...constClip('b', 10).tracks], 0),
    );
    const mask = masks.add(new AvatarMask(['a']));

    const player = app.world.spawn(
      new AnimationLayers([clipLayer(base, 'override'), clipLayer(upper, 'override', mask)]),
    );
    const boneA = app.world.spawn(new Transform(), new AnimationTarget('a', player));
    const boneB = app.world.spawn(new Transform(), new AnimationTarget('b', player));

    app.advanceFrame(0);

    expect(near(app.world.getComponent(boneA, Transform)!.translation[0]!, 10)).toBe(true);
    // Bone B is masked out of the upper layer, so the base layer shows through.
    expect(near(app.world.getComponent(boneB, Transform)!.translation[0]!, 2)).toBe(true);
  });

  it('adds an additive layer on top of the base relative to the bind pose', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const clips = app.getResource(AnimationClips)!;

    const base = clips.add(constClip('a', 5));
    const additive = clips.add(constClip('a', 2)); // delta vs bind (0) is +2

    const player = app.world.spawn(
      new AnimationLayers([clipLayer(base, 'override'), clipLayer(additive, 'additive')]),
    );
    const boneA = app.world.spawn(new Transform(), new AnimationTarget('a', player));

    app.advanceFrame(0);

    // base 5 + additive delta (2 − bind 0) at weight 1 = 7.
    expect(near(app.world.getComponent(boneA, Transform)!.translation[0]!, 7)).toBe(true);
  });

  it('sweeping an upper override layer weight blends between base and upper', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const clips = app.getResource(AnimationClips)!;
    const base = clips.add(constClip('a', 0));
    const upper = clips.add(constClip('a', 10));

    const layers = new AnimationLayers([clipLayer(base, 'override'), clipLayer(upper, 'override')]);
    layers.layers[1]!.weight = 0.5;
    const player = app.world.spawn(layers);
    const boneA = app.world.spawn(new Transform(), new AnimationTarget('a', player));

    app.advanceFrame(0);
    expect(near(app.world.getComponent(boneA, Transform)!.translation[0]!, 5)).toBe(true);
  });
});
