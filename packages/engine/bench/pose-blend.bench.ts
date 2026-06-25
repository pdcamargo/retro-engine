// Pose-blend hot path (ADR-0118). Each frame the animation system samples every
// active clip into a per-bone pose and blends them: cost grows with
// `bones × sources` (clips in a blend tree, layers, crossfading states). This
// bench measures the accumulate + finalize inner loop across bone counts and
// source counts, excluding clip sampling and the Transform commit so it isolates
// the blend math.
//
// See docs/adr/ADR-0017 (bench schema).

import { bench, summary } from 'mitata';

import {
  accumulateRotation,
  accumulateScale,
  accumulateTranslation,
  finalizePose,
} from '../src/animation/pose-blend';
import { Pose } from '../src/animation/pose';

const BONE_COUNTS = [32, 64] as const;
const SOURCE_COUNTS = [2, 4, 8] as const;

// A handful of arbitrary unit-ish quaternions to blend, varied per source/bone.
const quat = (seed: number): [number, number, number, number] => {
  const a = seed * 0.37;
  const x = Math.sin(a);
  const y = Math.sin(a + 1);
  const z = Math.sin(a + 2);
  const w = Math.cos(a);
  const len = Math.hypot(x, y, z, w) || 1;
  return [x / len, y / len, z / len, w / len];
};

const blendFrame = (pose: Pose, bones: number, sources: number): void => {
  pose.beginAccumulate(bones);
  const weight = 1 / sources;
  for (let s = 0; s < sources; s++) {
    for (let b = 0; b < bones; b++) {
      accumulateTranslation(pose, b, s * 0.1, b * 0.01, 0, weight);
      accumulateScale(pose, b, 1, 1, 1, weight);
      const [x, y, z, w] = quat(s * 13 + b);
      accumulateRotation(pose, b, x, y, z, w, weight);
    }
  }
  finalizePose(pose);
};

summary(() => {
  for (const bones of BONE_COUNTS) {
    for (const sources of SOURCE_COUNTS) {
      bench(`pose blend @ ${bones} bones × ${sources} sources`, function* () {
        const pose = new Pose(bones);
        yield () => blendFrame(pose, bones, sources);
      });
    }
  }
});
