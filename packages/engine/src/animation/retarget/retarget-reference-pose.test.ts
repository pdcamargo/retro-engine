import type { Quat, Vec3 } from '@retro-engine/math';
import { mat4, quat, vec3 } from '@retro-engine/math';
import { describe, expect, it } from 'bun:test';

import type { AnimationTrack } from '../animation-clip';
import { AnimationClip } from '../animation-clip';
import type { HumanoidSlot } from './humanoid';
import { HUMANOID_SLOTS } from './humanoid';
import { retargetClip } from './retarget-clip';
import type { ReferencePoseBone } from './retarget-reference-pose';
import { computeReferencePose, frameFromAxes } from './retarget-reference-pose';
import type { RetargetSlot } from './retarget-rig';
import { RetargetRig } from './retarget-rig';

const near = (a: ArrayLike<number>, b: readonly number[], eps = 1e-4): void => {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < b.length; i++) expect(a[i]!).toBeCloseTo(b[i]!, 4 + (eps < 1e-4 ? 1 : 0));
};
const unit = (x: number, y: number, z: number): Vec3 => vec3.normalize(vec3.create(x, y, z), vec3.create());

describe('frameFromAxes', () => {
  it('builds a right-handed orthonormal frame with the primary as its first column', () => {
    const m = mat4.create();
    expect(frameFromAxes(vec3.create(2, 0, 0), vec3.create(0, 1, 0), m)).toBe(true);
    // primary +X, secondary +Y → identity basis.
    near([m[0]!, m[1]!, m[2]!], [1, 0, 0]);
    near([m[4]!, m[5]!, m[6]!], [0, 1, 0]);
    near([m[8]!, m[9]!, m[10]!], [0, 0, 1]);
    // Right-handed: col1 × col2 = col3.
    const c1 = vec3.create(m[0]!, m[1]!, m[2]!);
    const c2 = vec3.create(m[4]!, m[5]!, m[6]!);
    const c3 = vec3.create(m[8]!, m[9]!, m[10]!);
    near(vec3.cross(c1, c2, vec3.create()), [c3[0]!, c3[1]!, c3[2]!]);
  });

  it('fails on a degenerate frame (secondary parallel to primary)', () => {
    const m = mat4.create();
    expect(frameFromAxes(vec3.create(1, 0, 0), vec3.create(2, 0, 0), m)).toBe(false);
    expect(frameFromAxes(vec3.create(0, 0, 0), vec3.create(0, 1, 0), m)).toBe(false);
  });
});

// A small humanoid chain. Parent of each slot (nearest mapped ancestor).
const PARENT: Partial<Record<HumanoidSlot, HumanoidSlot>> = {
  Spine: 'Hips',
  Neck: 'Spine',
  Head: 'Neck',
  LeftUpperLeg: 'Hips',
  RightUpperLeg: 'Hips',
  LeftShoulder: 'Spine',
  LeftUpperArm: 'LeftShoulder',
  LeftLowerArm: 'LeftUpperArm',
  LeftHand: 'LeftLowerArm',
};

type Positions = Partial<Record<HumanoidSlot, readonly [number, number, number]>>;
type Rolls = Partial<Record<HumanoidSlot, Quat>>;

// Build a synthetic rig: bind world positions per slot, optional per-bone world
// rotation (a "bone axis" roll), parent chain from PARENT. parentRestWorldR is
// kept consistent with the parent's restWorldR so a clip FK's correctly.
const buildRig = (pos: Positions, rolls: Rolls = {}): RetargetRig => {
  const slotsPresent = (Object.keys(pos) as HumanoidSlot[]).filter((s) => pos[s] !== undefined);
  const worldR = (s: HumanoidSlot): Quat => rolls[s] ?? quat.identity();
  const bones: ReferencePoseBone[] = slotsPresent.map((s) => {
    const p = PARENT[s];
    const pr = pos[s]!;
    return {
      slot: s,
      restWorldT: vec3.create(pr[0], pr[1], pr[2]),
      restWorldR: worldR(s),
      parentRestWorldR: p !== undefined ? worldR(p) : quat.identity(),
      parentSlot: p,
    };
  });
  const ref = computeReferencePose(bones);
  const slots: RetargetSlot[] = bones.map((b) => {
    const e = ref.get(b.slot)!;
    return {
      slot: b.slot,
      boneId: b.slot,
      restT: vec3.create(0, 0, 0),
      restR: quat.identity(),
      restS: vec3.create(1, 1, 1),
      restWorldT: b.restWorldT,
      restWorldR: b.restWorldR,
      parentRestWorldR: b.parentRestWorldR,
      refWorldR: e.refWorldR,
      parentRefWorldR: e.parentRefWorldR,
    };
  });
  return new RetargetRig(slots);
};

// The source's bind bone direction toward its mapped child (world).
const boneDir = (rig: RetargetRig, slot: HumanoidSlot, child: HumanoidSlot): Vec3 => {
  const a = rig.slot(slot)!.restWorldT;
  const b = rig.slot(child)!.restWorldT;
  return vec3.normalize(vec3.subtract(b, a, vec3.create()), vec3.create());
};

// A clip that holds every mapped bone at its bind (identity local rotations),
// addressing bones by slot name (= boneId in buildRig). Source rigs in this test
// have identity restWorldR, so identity locals are exactly the source bind pose.
const bindPoseClip = (rig: RetargetRig): AnimationClip => {
  const tracks: AnimationTrack[] = rig.slots.map((s) => ({
    target: { targetId: s.boneId, component: 'Transform', path: [{ kind: 'field', name: 'rotation' }] as never },
    sampler: {
      times: new Float32Array([0]),
      values: new Float32Array([0, 0, 0, 1]),
      componentCount: 4,
      interpolation: 'LINEAR',
    },
  }));
  return new AnimationClip(tracks, 0);
};

// FK the retargeted clip onto the target rig and return a bone's world direction
// (the bind bone-axis re-oriented by the FK'd world rotation). HUMANOID_SLOTS is
// root-before-leaf, so parents resolve first.
const retargetedBoneDir = (
  target: RetargetRig,
  clip: AnimationClip,
  slot: HumanoidSlot,
  child: HumanoidSlot,
): Vec3 => {
  const local = new Map<HumanoidSlot, Quat>();
  for (const t of clip.tracks) {
    const s = target.slotByBoneId.get(t.target.targetId);
    if (s !== undefined) local.set(s, quat.create(t.sampler.values[0]!, t.sampler.values[1]!, t.sampler.values[2]!, t.sampler.values[3]!));
  }
  const world = new Map<HumanoidSlot, Quat>();
  for (const s of HUMANOID_SLOTS) {
    const entry = target.slot(s);
    if (entry === undefined) continue;
    const l = local.get(s) ?? quat.create();
    const parent = PARENT[s];
    const pw = parent !== undefined ? world.get(parent) ?? quat.identity() : quat.identity();
    world.set(s, quat.multiply(pw, l, quat.create()));
  }
  // localBoneAxis = restWorldR⁻¹ · bindBoneDir; world dir = worldR · localBoneAxis.
  const bind = boneDir(target, slot, child);
  const localAxis = vec3.transformQuat(bind, quat.inverse(target.slot(slot)!.restWorldR, quat.create()), vec3.create());
  return vec3.normalize(vec3.transformQuat(localAxis, world.get(slot)!, vec3.create()), vec3.create());
};

describe('computeReferencePose', () => {
  // A-pose: arm angled down-and-out from the shoulder.
  const aPose: Positions = {
    Hips: [0, 1.0, 0],
    Spine: [0, 1.2, 0],
    Neck: [0, 1.5, 0],
    Head: [0, 1.6, 0],
    LeftUpperLeg: [0.1, 0.95, 0],
    RightUpperLeg: [-0.1, 0.95, 0],
    LeftShoulder: [0.05, 1.45, 0],
    LeftUpperArm: [0.15, 1.4, 0],
    LeftLowerArm: [0.4, 1.1, 0],
    LeftHand: [0.65, 0.8, 0],
  };
  // T-pose, taller: arm straight out along +X.
  const tPose: Positions = {
    Hips: [0, 1.4, 0],
    Spine: [0, 1.7, 0],
    Neck: [0, 2.1, 0],
    Head: [0, 2.25, 0],
    LeftUpperLeg: [0.12, 1.35, 0],
    RightUpperLeg: [-0.12, 1.35, 0],
    LeftShoulder: [0.06, 2.05, 0],
    LeftUpperArm: [0.2, 2.0, 0],
    LeftLowerArm: [0.6, 2.0, 0],
    LeftHand: [1.0, 2.0, 0],
  };

  it('aims each bone along its canonical reference direction', () => {
    const rig = buildRig(aPose);
    // refWorldR · localBoneAxis must equal the canonical slot direction.
    const check = (slot: HumanoidSlot, child: HumanoidSlot, canon: readonly [number, number, number]): void => {
      const entry = rig.slot(slot)!;
      const localAxis = vec3.transformQuat(boneDir(rig, slot, child), quat.inverse(entry.restWorldR, quat.create()), vec3.create());
      const aimed = vec3.normalize(vec3.transformQuat(localAxis, entry.refWorldR, vec3.create()), vec3.create());
      near(aimed, [...unit(canon[0], canon[1], canon[2])]);
    };
    check('Spine', 'Neck', [0, 1, 0]); // spine up
    check('LeftUpperArm', 'LeftLowerArm', [1, 0, 0]); // arm out along +X
    check('LeftLowerArm', 'LeftHand', [1, 0, 0]);
  });

  it('reproduces the source pose on a differently-bound target (A-pose source → T-pose target)', () => {
    const source = buildRig(aPose);
    const target = buildRig(tPose);
    const out = retargetClip(bindPoseClip(source), source, target, { rootTranslationMode: 'targetBindPose' });

    // Driven by the source at rest, the target's arm must take the SOURCE's
    // A-pose direction (down-and-out), NOT its own T-pose bind (+X horizontal).
    const srcArm = boneDir(source, 'LeftUpperArm', 'LeftLowerArm'); // ≈ (0.64, -0.77, 0)
    const tgtArm = retargetedBoneDir(target, out, 'LeftUpperArm', 'LeftLowerArm');
    near(tgtArm, [srcArm[0]!, srcArm[1]!, srcArm[2]!]);
    expect(tgtArm[1]!).toBeLessThan(-0.3); // clearly angled down — not the T-pose's y≈0

    const srcFore = boneDir(source, 'LeftLowerArm', 'LeftHand');
    const tgtFore = retargetedBoneDir(target, out, 'LeftLowerArm', 'LeftHand');
    near(tgtFore, [srcFore[0]!, srcFore[1]!, srcFore[2]!]);
  });

  it('is immune to the target rig\'s per-bone axis convention (bone roll)', () => {
    const source = buildRig(aPose);
    // Same T-pose target, but every arm bone carries a 90° roll about its own axis
    // (a Blender re-roll). The position-based reference must cancel it out.
    const roll = quat.fromEuler(Math.PI / 2, 0, 0, 'xyz');
    const target = buildRig(tPose, {
      LeftShoulder: roll,
      LeftUpperArm: roll,
      LeftLowerArm: roll,
      LeftHand: roll,
    });
    const out = retargetClip(bindPoseClip(source), source, target, { rootTranslationMode: 'targetBindPose' });

    const srcArm = boneDir(source, 'LeftUpperArm', 'LeftLowerArm');
    const tgtArm = retargetedBoneDir(target, out, 'LeftUpperArm', 'LeftLowerArm');
    near(tgtArm, [srcArm[0]!, srcArm[1]!, srcArm[2]!]);
  });

  it('honours an authored reference-pose override', () => {
    const bones: ReferencePoseBone[] = [
      { slot: 'Hips', restWorldT: vec3.create(0, 1, 0), restWorldR: quat.identity(), parentRestWorldR: quat.identity(), parentSlot: undefined },
      { slot: 'Spine', restWorldT: vec3.create(0, 1.2, 0), restWorldR: quat.identity(), parentRestWorldR: quat.identity(), parentSlot: 'Hips' },
    ];
    const authored = quat.fromEuler(0.1, 0.2, 0.3, 'xyz');
    const ref = computeReferencePose(bones, { Spine: authored });
    near(ref.get('Spine')!.refWorldR, [...authored]);
  });
});
