// IK solve hot path (ADR-0121). The IK post-pass solves each constraint every
// frame after transform propagation: two-bone analytic (limbs/foot/hand), CCD
// for N-bone chains (cost grows with bones × iterations), and look-at/aim. This
// bench isolates the pure solver math (no ECS reads, no re-propagation) across
// representative chain lengths and iteration counts.
//
// See docs/adr/ADR-0017 (bench schema).

import { quat, vec3 } from '@retro-engine/math';
import { bench, summary } from 'mitata';

import { solveCcd, type CcdSolveInput } from '../src/animation/ik/ccd';
import { solveAim, type AimSolveInput } from '../src/animation/ik/look-at';
import { solveTwoBone, type TwoBoneSolveInput, type TwoBoneSolveOutput } from '../src/animation/ik/two-bone';

const CHAIN_LENGTHS = [4, 8, 16] as const;
const CCD_ITERATIONS = [5, 10, 20] as const;

const twoBoneInput: TwoBoneSolveInput = {
  rootPos: vec3.create(0, 0, 0),
  midPos: vec3.create(0, -1, 0.1),
  tipPos: vec3.create(0, -2, 0),
  targetPos: vec3.create(0.5, -1.5, 0.5),
  polePos: vec3.create(0, -1, 1),
  rootWorldRot: quat.identity(),
  midWorldRot: quat.identity(),
  rootParentWorldRot: quat.identity(),
};
const twoBoneOut: TwoBoneSolveOutput = {
  rootLocalRot: quat.create(),
  midLocalRot: quat.create(),
  midWorldRot: quat.create(),
};

const aimInput: AimSolveInput = {
  bonePos: vec3.create(0, 0, 0),
  boneWorldRot: quat.identity(),
  boneParentWorldRot: quat.identity(),
  targetPos: vec3.create(1, 0.5, 0.3),
  aimAxis: vec3.create(0, 0, 1),
  upAxis: vec3.create(0, 1, 0),
  worldUp: vec3.create(0, 1, 0),
};
const aimOut = quat.create();

const makeChain = (n: number): CcdSolveInput => {
  const jointWorldPos = Array.from({ length: n }, (_, i) => vec3.create(0, -i, 0));
  const jointWorldRot = Array.from({ length: n }, () => quat.identity());
  return {
    jointWorldPos,
    jointWorldRot,
    rootParentWorldRot: quat.identity(),
    // Reachable but off-axis so every joint contributes.
    targetPos: vec3.create(n * 0.4, -(n - 1) * 0.6, n * 0.2),
    iterations: 10,
    tolerance: 0.001,
  };
};

summary(() => {
  bench('two-bone solve', function* () {
    yield () => solveTwoBone(twoBoneInput, twoBoneOut);
  });

  bench('look-at solve', function* () {
    yield () => solveAim(aimInput, aimOut);
  });

  for (const n of CHAIN_LENGTHS) {
    for (const iterations of CCD_ITERATIONS) {
      const input = { ...makeChain(n), iterations };
      const out = Array.from({ length: n - 1 }, () => quat.create());
      bench(`ccd solve @ ${n} bones × ${iterations} iters`, function* () {
        yield () => solveCcd(input, out);
      });
    }
  }
});
