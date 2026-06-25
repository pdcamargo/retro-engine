import { quat, type Quat, vec3, type Vec3 } from '@retro-engine/math';
import { describe, expect, it } from 'bun:test';

import { solveCcd } from './ccd';
import { solveAim } from './look-at';
import { solveTwoBone, type TwoBoneSolveOutput } from './two-bone';

// Forward-kinematics reconstruction of a direct two-bone chain whose rest offsets
// are mid = root + (0,-1,0) and tip = mid + (0,-1,0), with identity parents — so a
// test can check that the solved local rotations actually place the tip on target.
const reconstructTip = (out: TwoBoneSolveOutput): { mid: Vec3; tip: Vec3 } => {
  const rootWorld = out.rootLocalRot; // parent is identity
  const mid = vec3.transformQuat(vec3.create(0, -1, 0), rootWorld, vec3.create());
  const tipOffset = vec3.transformQuat(vec3.create(0, -1, 0), out.midWorldRot, vec3.create());
  const tip = vec3.add(mid, tipOffset, vec3.create());
  return { mid, tip };
};

const makeOut = (): TwoBoneSolveOutput => ({
  rootLocalRot: quat.create(),
  midLocalRot: quat.create(),
  midWorldRot: quat.create(),
});

const baseInput = (targetPos: Vec3, polePos: Vec3 | null) => ({
  rootPos: vec3.create(0, 0, 0),
  midPos: vec3.create(0, -1, 0),
  tipPos: vec3.create(0, -2, 0),
  targetPos,
  polePos,
  rootWorldRot: quat.identity(),
  midWorldRot: quat.identity(),
  rootParentWorldRot: quat.identity(),
});

describe('solveTwoBone', () => {
  it('places the tip on a reachable target', () => {
    const out = makeOut();
    solveTwoBone(baseInput(vec3.create(1, -1, 0), null), out);
    const { tip } = reconstructTip(out);
    expect(vec3.distance(tip, vec3.create(1, -1, 0))).toBeLessThan(1e-4);
  });

  it('extends straight toward an out-of-reach target (clamped reach)', () => {
    const out = makeOut();
    // Distance 10 ≫ 2 (max reach). The tip should land on the root→target ray,
    // just short of full extension.
    solveTwoBone(baseInput(vec3.create(0, -10, 0), null), out);
    const { tip } = reconstructTip(out);
    expect(tip[0]!).toBeCloseTo(0, 4);
    expect(tip[2]!).toBeCloseTo(0, 4);
    // Nearly fully extended (length ~2) along -Y.
    expect(vec3.length(tip)).toBeGreaterThan(1.9);
    expect(vec3.length(tip)).toBeLessThanOrEqual(2.0001);
  });

  it('keeps the FK bend plane when no pole is given', () => {
    const out = makeOut();
    solveTwoBone(baseInput(vec3.create(1, -1, 0), null), out);
    const { mid, tip } = reconstructTip(out);
    // The starting chain lies in the z=0 plane; without a pole it stays there.
    expect(Math.abs(mid[2]!)).toBeLessThan(1e-4);
    expect(Math.abs(tip[2]!)).toBeLessThan(1e-4);
  });

  it('bends the mid joint toward the pole', () => {
    const out = makeOut();
    solveTwoBone(baseInput(vec3.create(1, -1, 0), vec3.create(0, -1, 1)), out);
    const { mid } = reconstructTip(out);
    // Pole at +z pulls the knee toward +z.
    expect(mid[2]!).toBeGreaterThan(0.1);
  });
});

describe('solveCcd', () => {
  it('reaches a reachable target within tolerance', () => {
    const n = 4;
    const jointWorldPos: Vec3[] = Array.from({ length: n }, (_, i) => vec3.create(0, -i, 0));
    const jointWorldRot: Quat[] = Array.from({ length: n }, () => quat.identity());
    const target = vec3.create(1.5, -1.5, 0);
    const out: Quat[] = Array.from({ length: n - 1 }, () => quat.create());
    solveCcd(
      {
        jointWorldPos,
        jointWorldRot,
        rootParentWorldRot: quat.identity(),
        targetPos: target,
        iterations: 30,
        tolerance: 1e-4,
      },
      out,
    );
    // Reconstruct world positions from the solved local rotations (each joint's
    // parent is the previous joint; rest offset is (0,-1,0)).
    const worldRot: Quat[] = [];
    const pos: Vec3[] = [vec3.create(0, 0, 0)];
    for (let i = 0; i < n - 1; i++) {
      const parentWorld = i === 0 ? quat.identity() : worldRot[i - 1]!;
      worldRot.push(quat.multiply(parentWorld, out[i]!, quat.create()));
      const offset = vec3.transformQuat(vec3.create(0, -1, 0), worldRot[i]!, vec3.create());
      pos.push(vec3.add(pos[i]!, offset, vec3.create()));
    }
    expect(vec3.distance(pos[n - 1]!, target)).toBeLessThan(1e-2);
  });
});

describe('solveAim', () => {
  it('points the local aim axis at the target', () => {
    const out = quat.create();
    solveAim(
      {
        bonePos: vec3.create(0, 0, 0),
        boneWorldRot: quat.identity(),
        boneParentWorldRot: quat.identity(),
        targetPos: vec3.create(1, 0, 0),
        aimAxis: vec3.create(0, 0, 1),
        upAxis: vec3.create(0, 1, 0),
        worldUp: vec3.create(0, 1, 0),
      },
      out,
    );
    // Parent is identity, so the local rotation is the world rotation. The local
    // +Z axis should now point along +X (toward the target).
    const aimed = vec3.transformQuat(vec3.create(0, 0, 1), out, vec3.create());
    expect(aimed[0]!).toBeCloseTo(1, 4);
    expect(aimed[1]!).toBeCloseTo(0, 4);
    expect(aimed[2]!).toBeCloseTo(0, 4);
  });
});
