// Nested blend-tree evaluation hot path (ADR-0140, supersedes ADR-0119). Each
// frame a controller player evaluates its active state's motion into weighted
// clip contributions. With recursive blend trees that evaluation walks the whole
// nested structure per frame, so its cost grows with the leaf count and nesting
// depth. This bench measures `evaluateMotion` over the motivating fixture — an
// 8-way directional (freeformDirectional) tree whose every slot is a 1D speed
// blend (idle → walk → run) — plus a deeper chain, reusing a single pooled
// MotionScratch so it isolates the traversal/weighting cost with no per-call
// allocation. Clip resolution is an identity function so the sampler is excluded.
//
// See docs/adr/ADR-0017 (bench schema).

import { bench, summary } from 'mitata';

import type { Handle } from '@retro-engine/assets';

import type { AnimationClip } from '../src/animation/animation-clip';
import {
  type Motion,
  type MotionInput,
  MotionScratch,
  evaluateMotion,
} from '../src/animation/animation-controller';

const fakeClip = (duration: number): AnimationClip => ({ duration }) as unknown as AnimationClip;
const resolve = (h: Handle<AnimationClip>): AnimationClip => h as unknown as AnimationClip;
const leaf = (clip: AnimationClip): Motion => ({
  kind: 'clip',
  clip: clip as unknown as Handle<AnimationClip>,
});

const SPEED = [0, 0.5, 1] as const;

// 8-way directional outer tree, each slot a 1D speed blend on a separate param.
const buildDirectionalBySpeed = (): Motion => {
  const dirs = 8;
  return {
    kind: 'blend2d',
    mode: 'freeformDirectional',
    parameterX: 'moveX',
    parameterY: 'moveY',
    children: Array.from({ length: dirs }, (_unused, d) => {
      const angle = (d / dirs) * Math.PI * 2;
      return {
        motion: {
          kind: 'blend1d',
          parameter: 'speed',
          children: SPEED.map((threshold, k) => ({
            motion: leaf(fakeClip(1 + d * 0.1 + k * 0.01)),
            threshold,
          })),
        } satisfies Motion,
        x: Math.cos(angle),
        y: Math.sin(angle),
      };
    }),
  };
};

// A degenerate deep chain: `depth` nested 1D blends before the leaf, to isolate
// recursion overhead independent of fan-out.
const buildChain = (depth: number): Motion => {
  let motion: Motion = leaf(fakeClip(1));
  for (let i = 0; i < depth; i++) {
    motion = {
      kind: 'blend1d',
      parameter: `p${i}`,
      children: [
        { motion, threshold: 0 },
        { motion: leaf(fakeClip(1)), threshold: 1 },
      ],
    };
  }
  return motion;
};

summary(() => {
  const scratch = new MotionScratch();
  const out: MotionInput[] = [];

  bench('evaluateMotion: 8-way directional × speed (24 leaves)', function* () {
    const motion = buildDirectionalBySpeed();
    // A sample between two directions at mid speed so both layers do real work.
    const getFloat = (n: string): number =>
      n === 'moveX' ? 0.7 : n === 'moveY' ? 0.7 : n === 'speed' ? 0.4 : 0;
    yield () => {
      out.length = 0;
      evaluateMotion(motion, 0.4, 1, getFloat, resolve, scratch, out);
    };
  });

  for (const depth of [4, 8] as const) {
    bench(`evaluateMotion: deep 1D chain @ depth ${depth}`, function* () {
      const motion = buildChain(depth);
      const getFloat = (): number => 0.5;
      yield () => {
        out.length = 0;
        evaluateMotion(motion, 0.4, 1, getFloat, resolve, scratch, out);
      };
    });
  }
});
