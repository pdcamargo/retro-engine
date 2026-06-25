import { describe, expect, it } from 'bun:test';

import { App } from '../index';
import { makeHeadlessRenderer } from '../test-utils';
import { GlobalTransform, Transform } from '../transform';
import { AnimationClip } from './animation-clip';
import { AnimationClips } from './animation-clip-asset';
import { AnimationController } from './animation-controller';
import { AnimationControllers } from './animation-controller-asset';
import { AnimationControllerPlayer } from './animation-controller-player';
import { AnimationTarget } from './animation-player';

const near = (a: number, b: number, eps = 1e-3): boolean => Math.abs(a - b) <= eps;

/** A clip pinning its target bone to translation `(x, 0, 0)` (constant; one keyframe). */
const constTranslationClip = (x: number): AnimationClip =>
  new AnimationClip(
    [
      {
        target: { targetId: 'bone', component: 'Transform', path: [{ kind: 'field', name: 'translation' }] },
        sampler: {
          times: new Float32Array([0]),
          values: new Float32Array([x, 0, 0]),
          componentCount: 3,
          interpolation: 'LINEAR',
        },
      },
    ],
    0,
  );

describe('AnimationController playback', () => {
  it('blends a 1D blend-tree state across its parameter into committed bone Transforms', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const clips = app.getResource(AnimationClips)!;
    const controllers = app.getResource(AnimationControllers)!;
    const a = clips.add(constTranslationClip(0));
    const b = clips.add(constTranslationClip(10));

    const controller = new AnimationController(
      [{ name: 'blend', type: 'float', default: 0 }],
      [
        {
          name: 'locomotion',
          motion: {
            kind: 'blend1d',
            parameter: 'blend',
            children: [
              { clip: a, threshold: 0 },
              { clip: b, threshold: 1 },
            ],
          },
        },
      ],
      [],
      0,
    );
    const handle = controllers.add(controller);

    const player = app.world.spawn(
      new AnimationControllerPlayer(handle, 1, true, [{ name: 'blend', value: 0.5 }]),
    );
    const target = app.world.spawn(
      new Transform(),
      new GlobalTransform(),
      new AnimationTarget('bone', player),
    );

    app.advanceFrame(0);
    let t = app.world.getComponent(target, Transform)!;
    expect(near(t.translation[0]!, 5)).toBe(true); // halfway between the two clips

    const playerComp = app.world.getComponent(player, AnimationControllerPlayer)!;
    playerComp.parameters[0]!.value = 1;
    app.advanceFrame(16);
    t = app.world.getComponent(target, Transform)!;
    expect(near(t.translation[0]!, 10)).toBe(true);

    playerComp.parameters[0]!.value = 0;
    app.advanceFrame(32);
    t = app.world.getComponent(target, Transform)!;
    expect(near(t.translation[0]!, 0)).toBe(true);
  });

  it('crossfades between two states on a condition-driven transition', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const clips = app.getResource(AnimationClips)!;
    const controllers = app.getResource(AnimationControllers)!;
    const idle = clips.add(constTranslationClip(0));
    const run = clips.add(constTranslationClip(10));

    const controller = new AnimationController(
      [{ name: 'Speed', type: 'float', default: 0 }],
      [
        { name: 'Idle', motion: { kind: 'clip', clip: idle } },
        { name: 'Run', motion: { kind: 'clip', clip: run } },
      ],
      [
        {
          from: 0,
          to: 1,
          conditions: [{ parameter: 'Speed', op: 'gt', value: 0.5 }],
          duration: 0.3,
          hasExitTime: false,
          exitTime: 0,
        },
      ],
      0,
    );
    const handle = controllers.add(controller);

    const player = app.world.spawn(
      new AnimationControllerPlayer(handle, 1, true, [{ name: 'Speed', value: 0 }]),
    );
    const target = app.world.spawn(
      new Transform(),
      new GlobalTransform(),
      new AnimationTarget('bone', player),
    );

    app.advanceFrame(0);
    let t = app.world.getComponent(target, Transform)!;
    expect(near(t.translation[0]!, 0)).toBe(true); // Idle

    // Raise Speed → the transition fires and crossfades to Run over 0.3s.
    // advanceFrame takes an absolute timestamp, so step it forward by 100ms.
    app.world.getComponent(player, AnimationControllerPlayer)!.parameters[0]!.value = 1;
    for (let ms = 100; ms <= 600; ms += 100) app.advanceFrame(ms);
    t = app.world.getComponent(target, Transform)!;
    expect(near(t.translation[0]!, 10)).toBe(true); // settled on Run
  });
});
