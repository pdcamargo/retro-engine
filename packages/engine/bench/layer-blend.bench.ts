// Layer-blend hot path (ADR-0120). On top of the per-clip pose blend (ADR-0118),
// a layered player composes each finalized layer pose onto an accumulator —
// override or additive, masked per bone. That composition runs once per layer
// per frame, so cost grows with `bones × layers`. This bench measures the
// compose inner loop (override + additive, half the bones masked out) across
// bone and layer counts, excluding clip sampling and the Transform commit so it
// isolates the layer math.
//
// See docs/adr/ADR-0017 (bench schema).

import { bench, summary } from 'mitata';

import { composeLayerAdditive, composeLayerOverride } from '../src/animation/layer-blend';
import { Pose } from '../src/animation/pose';

const BONE_COUNTS = [32, 64] as const;
const LAYER_COUNTS = [1, 2, 4] as const;

const quat = (seed: number): [number, number, number, number] => {
  const a = seed * 0.37;
  const x = Math.sin(a);
  const y = Math.sin(a + 1);
  const z = Math.sin(a + 2);
  const w = Math.cos(a);
  const len = Math.hypot(x, y, z, w) || 1;
  return [x / len, y / len, z / len, w / len];
};

// A finalized layer pose: every bone animated (all weights 1), arbitrary TRS.
const makeLayerPose = (bones: number, seed: number): Pose => {
  const pose = new Pose(bones);
  pose.beginAccumulate(bones);
  for (let b = 0; b < bones; b++) {
    pose.t[b * 3] = (b + seed) * 0.01;
    pose.t[b * 3 + 1] = seed * 0.1;
    pose.t[b * 3 + 2] = 0;
    const [x, y, z, w] = quat(seed * 13 + b);
    pose.r[b * 4] = x;
    pose.r[b * 4 + 1] = y;
    pose.r[b * 4 + 2] = z;
    pose.r[b * 4 + 3] = w;
    pose.s[b * 3] = 1;
    pose.s[b * 3 + 1] = 1;
    pose.s[b * 3 + 2] = 1;
    pose.wt[b] = 1;
    pose.wr[b] = 1;
    pose.ws[b] = 1;
  }
  return pose;
};

// Identity reference pose (every field present) for the additive layer's delta.
const makeReferencePose = (bones: number): Pose => {
  const pose = new Pose(bones);
  pose.beginAccumulate(bones);
  for (let b = 0; b < bones; b++) {
    pose.r[b * 4 + 3] = 1;
    pose.s[b * 3] = 1;
    pose.s[b * 3 + 1] = 1;
    pose.s[b * 3 + 2] = 1;
    pose.wt[b] = 1;
    pose.wr[b] = 1;
    pose.ws[b] = 1;
  }
  return pose;
};

// Half the bones masked out, exercising the per-slot inclusion branch.
const makeMask = (bones: number): Uint8Array => {
  const mask = new Uint8Array(bones);
  for (let b = 0; b < bones; b++) mask[b] = b % 2 === 0 ? 1 : 0;
  return mask;
};

const composeStack = (
  acc: Pose,
  layer: Pose,
  reference: Pose,
  mask: Uint8Array,
  bones: number,
  layers: number,
): void => {
  acc.beginAccumulate(bones);
  for (let li = 0; li < layers; li++) {
    if (li % 2 === 1) composeLayerAdditive(acc, layer, reference, 0.5, mask);
    else composeLayerOverride(acc, layer, li === 0 ? 1 : 0.5, mask);
  }
};

summary(() => {
  for (const bones of BONE_COUNTS) {
    for (const layers of LAYER_COUNTS) {
      bench(`layer compose @ ${bones} bones × ${layers} layers`, function* () {
        const acc = new Pose(bones);
        const layer = makeLayerPose(bones, 1);
        const reference = makeReferencePose(bones);
        const mask = makeMask(bones);
        yield () => composeStack(acc, layer, reference, mask, bones, layers);
      });
    }
  }
});
