import { describe, expect, it } from 'bun:test';

import type { Handle } from '@retro-engine/assets';

import { App } from '../index';
import { makeHeadlessRenderer } from '../test-utils';
import { GlobalTransform, Transform } from '../transform';
import { AnimationClip } from './animation-clip';
import { AnimationClips } from './animation-clip-asset';
import {
  AnimationController,
  type Motion,
  type MotionInput,
  MotionScratch,
  evaluateMotion,
  motionDuration,
} from './animation-controller';
import { AnimationControllers } from './animation-controller-asset';
import { AnimationControllerPlayer } from './animation-controller-player';
import { AnimationTarget } from './animation-player';
import { weights1d, weights2d } from './blend-tree';

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
              { motion: { kind: 'clip', clip: a }, threshold: 0 },
              { motion: { kind: 'clip', clip: b }, threshold: 1 },
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

// Identity clip/handle plumbing so a leaf motion resolves to a clip we can
// identify by reference in the evaluateMotion output.
const fakeClip = (duration: number): AnimationClip =>
  ({ duration, tracks: [] }) as unknown as AnimationClip;
const resolveIdentity = (h: Handle<AnimationClip>): AnimationClip =>
  h as unknown as AnimationClip;
const leaf = (clip: AnimationClip): Motion => ({
  kind: 'clip',
  clip: clip as unknown as Handle<AnimationClip>,
});

/** Total weight landing on each clip in `out`, keyed by clip identity. */
const weightByClip = (out: readonly MotionInput[]): Map<AnimationClip, number> => {
  const m = new Map<AnimationClip, number>();
  for (const input of out) m.set(input.clip, (m.get(input.clip) ?? 0) + input.weight);
  return m;
};

describe('evaluateMotion — nested blend trees', () => {
  it('8-way directional × per-direction speed: leaf weight is the product of outer and inner weights', () => {
    const DIRS = 8;
    const SPEED = [0, 0.5, 1] as const;

    // Outer directional points on the unit circle (E, NE, N, …).
    const positions = new Float32Array(DIRS * 2);
    for (let d = 0; d < DIRS; d++) {
      const angle = (d / DIRS) * Math.PI * 2;
      positions[d * 2] = Math.cos(angle);
      positions[d * 2 + 1] = Math.sin(angle);
    }

    // A distinct leaf clip per (direction, speed slot), with distinct durations.
    const leaves: AnimationClip[][] = [];
    for (let d = 0; d < DIRS; d++) {
      leaves[d] = [];
      for (let k = 0; k < SPEED.length; k++) leaves[d]![k] = fakeClip(1 + d * 0.1 + k * 0.01);
    }

    // Each of the 8 directions is itself a 1D blend on a *different* parameter
    // (`speed`) than the outer tree (`moveX`/`moveY`).
    const inner = (d: number): Motion => ({
      kind: 'blend1d',
      parameter: 'speed',
      children: SPEED.map((threshold, k) => ({ motion: leaf(leaves[d]![k]!), threshold })),
    });
    const outer: Motion = {
      kind: 'blend2d',
      mode: 'freeformDirectional',
      parameterX: 'moveX',
      parameterY: 'moveY',
      children: Array.from({ length: DIRS }, (_unused, d) => ({
        motion: inner(d),
        x: positions[d * 2]!,
        y: positions[d * 2 + 1]!,
      })),
    };

    const scratch = new MotionScratch();
    const check = (moveX: number, moveY: number, speed: number): void => {
      const getFloat = (n: string): number =>
        n === 'moveX' ? moveX : n === 'moveY' ? moveY : n === 'speed' ? speed : 0;
      const phase = 0.4;
      const out: MotionInput[] = [];
      evaluateMotion(outer, phase, 1, getFloat, resolveIdentity, scratch, out);

      // Independently derive the two weight layers and take their product.
      const outerW = new Float32Array(DIRS);
      weights2d('freeformDirectional', positions, DIRS, moveX, moveY, outerW);
      const innerW = new Float32Array(SPEED.length);
      weights1d(SPEED, speed, innerW);

      const got = weightByClip(out);
      let total = 0;
      for (let d = 0; d < DIRS; d++) {
        for (let k = 0; k < SPEED.length; k++) {
          const expected = outerW[d]! * innerW[k]!;
          total += expected;
          expect(got.get(leaves[d]![k]!) ?? 0).toBeCloseTo(expected, 6);
        }
      }
      expect(total).toBeCloseTo(1, 6);
      // Phase propagates down unchanged: every leaf sampled at phase × duration.
      for (const input of out) expect(input.time).toBeCloseTo(phase * input.clip.duration, 6);
    };

    check(1, 0, 0.75); // straight East, mid speed
    check(0.7, 0.7, 0.25); // between E and NE, low-mid speed
    check(-0.4, 0.9, 1); // NW-ish, full run
    check(0.2, -0.6, 0); // SSE, idle
  });

  it('nests arbitrarily deep (depth ≥ 3), weighting a leaf by the product along its path', () => {
    const z0 = fakeClip(1);
    const z1 = fakeClip(1);
    const y = fakeClip(1);
    const x = fakeClip(1);

    const blendC: Motion = {
      kind: 'blend1d',
      parameter: 'pC',
      children: [
        { motion: leaf(z0), threshold: 0 },
        { motion: leaf(z1), threshold: 1 },
      ],
    };
    const blendB: Motion = {
      kind: 'blend1d',
      parameter: 'pB',
      children: [
        { motion: blendC, threshold: 0 },
        { motion: leaf(y), threshold: 1 },
      ],
    };
    const blendA: Motion = {
      kind: 'blend1d',
      parameter: 'pA',
      children: [
        { motion: blendB, threshold: 0 },
        { motion: leaf(x), threshold: 1 },
      ],
    };

    // pA=0.25 → [0.75, 0.25]; pB=0.5 → [0.5, 0.5]; pC=0.5 → [0.5, 0.5].
    const getFloat = (n: string): number => (n === 'pA' ? 0.25 : 0.5);
    const out: MotionInput[] = [];
    evaluateMotion(blendA, 0, 1, getFloat, resolveIdentity, new MotionScratch(), out);
    const got = weightByClip(out);

    expect(got.get(x)).toBeCloseTo(0.25, 6);
    expect(got.get(y)).toBeCloseTo(0.75 * 0.5, 6);
    expect(got.get(z0)).toBeCloseTo(0.75 * 0.5 * 0.5, 6);
    expect(got.get(z1)).toBeCloseTo(0.75 * 0.5 * 0.5, 6);
    let total = 0;
    for (const w of got.values()) total += w;
    expect(total).toBeCloseTo(1, 6);
  });

  it('scales every leaf by the incoming state weight (crossfade share)', () => {
    const a = fakeClip(1);
    const b = fakeClip(1);
    const motion: Motion = {
      kind: 'blend1d',
      parameter: 'p',
      children: [
        { motion: leaf(a), threshold: 0 },
        { motion: leaf(b), threshold: 1 },
      ],
    };
    const out: MotionInput[] = [];
    evaluateMotion(motion, 0, 0.4, () => 0.5, resolveIdentity, new MotionScratch(), out);
    const got = weightByClip(out);
    expect(got.get(a)).toBeCloseTo(0.4 * 0.5, 6);
    expect(got.get(b)).toBeCloseTo(0.4 * 0.5, 6);
  });
});

describe('motionDuration — nested blend trees', () => {
  it('returns the longest leaf-clip duration anywhere in the tree', () => {
    const short = fakeClip(0.5);
    const longest = fakeClip(3);
    const mid = fakeClip(1.5);
    const nested: Motion = {
      kind: 'blend2d',
      mode: 'freeformCartesian',
      parameterX: 'x',
      parameterY: 'y',
      children: [
        {
          motion: {
            kind: 'blend1d',
            parameter: 'speed',
            children: [
              { motion: leaf(short), threshold: 0 },
              { motion: leaf(longest), threshold: 1 },
            ],
          },
          x: 0,
          y: 0,
        },
        { motion: leaf(mid), x: 1, y: 0 },
      ],
    };
    expect(motionDuration(nested, resolveIdentity)).toBe(3);
  });
});
