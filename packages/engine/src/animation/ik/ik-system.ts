import type { ComponentType, Entity } from '@retro-engine/ecs';
import type { Quat, Vec3 } from '@retro-engine/math';
import { mat4, quat, vec3 } from '@retro-engine/math';

import { Parent, recomputeWorldSubtree } from '../../hierarchy';
import type { App } from '../../index';
import { Query } from '../../system-param';
import { decomposeTransformInto, GlobalTransform, Transform } from '../../transform';
import { solveCcd } from './ccd';
import { IkChain, LookAtConstraint, TwoBoneIK } from './ik-constraints';
import { solveAim } from './look-at';
import { solveTwoBone, type TwoBoneSolveOutput } from './two-bone';

const TransformType = Transform as ComponentType;

/**
 * Register the IK post-pass. It runs in `postUpdate` **after** transform
 * propagation (so it reads valid world transforms) and **before** the skinning
 * palette compute (so the corrected pose reaches the GPU the same frame). Each
 * enabled constraint, in ascending `order`, reads its bones' world transforms,
 * solves, writes weighted local rotations blended over the FK pose, and
 * re-propagates just its affected chain in place — the gated propagation has
 * already run this frame and will not run again.
 */
export const addIkSolve = (app: App): void => {
  const world = app.world;

  // Reusable scratch — the solve runs on the single render thread.
  const decT = vec3.create();
  const decS = vec3.create();
  const worldPos = vec3.create();
  const fkRoot = quat.create();
  const fkMid = quat.create();
  const fkTip = quat.create();
  const fkBone = quat.create();
  const targetRot = quat.create();
  const tipWorldCur = quat.create();
  const tipWorldIk = quat.create();
  const tipLocalIk = quat.create();
  const blended = quat.create();
  const invMid = quat.create();
  const twoBoneOut: TwoBoneSolveOutput = {
    rootLocalRot: quat.create(),
    midLocalRot: quat.create(),
    midWorldRot: quat.create(),
  };

  // Per-constraint scratch — constraints solve one at a time, sequentially.
  const rootPos = vec3.create();
  const midPos = vec3.create();
  const tipPos = vec3.create();
  const polePos = vec3.create();
  const targetPos = vec3.create();
  const rootWorldRot = quat.create();
  const midWorldRot = quat.create();
  const parentWorldRot = quat.create();
  const aimOut = quat.create();

  // Growable pools for the CCD chain (positions / rotations / outputs by index).
  const chainPos: Vec3[] = [];
  const chainRot: Quat[] = [];
  const chainOut: Quat[] = [];
  const chainFk: Quat[] = [];
  // Exact-length views handed to the solver (which reads `.length`), refilled
  // from the pools each chain so the pools can stay oversized.
  const chainPosView: Vec3[] = [];
  const chainRotView: Quat[] = [];
  const ensureChain = (n: number): void => {
    while (chainPos.length < n) {
      chainPos.push(vec3.create());
      chainRot.push(quat.create());
      chainOut.push(quat.create());
      chainFk.push(quat.create());
    }
  };

  const readWorldPos = (entity: Entity, out: Vec3): boolean => {
    const g = world.getComponent(entity, GlobalTransform);
    if (g === undefined) return false;
    mat4.getTranslation(g.matrix, out);
    return true;
  };
  const readWorldRot = (entity: Entity, out: Quat): boolean => {
    const g = world.getComponent(entity, GlobalTransform);
    if (g === undefined) return false;
    decomposeTransformInto(decT, out, decS, g.matrix);
    return true;
  };
  const readParentWorldRot = (entity: Entity, out: Quat): void => {
    const parent = world.getComponent(entity, Parent);
    if (parent !== undefined && world.hasEntity(parent.entity) && readWorldRot(parent.entity, out)) {
      return;
    }
    quat.identity(out);
  };
  // Blend an IK local rotation over the bone's current (FK) local by `weight`
  // and write it back, marking the bone changed.
  const writeBlended = (entity: Entity, fk: Quat, ik: Quat, weight: number): void => {
    const transform = world.getComponent(entity, Transform);
    if (transform === undefined) return;
    if (weight >= 1) {
      quat.copy(ik, transform.rotation);
    } else {
      quat.slerp(fk, ik, weight, blended);
      quat.copy(blended, transform.rotation);
    }
    world.markChanged(entity, TransformType);
  };

  const solveTwoBoneConstraint = (c: TwoBoneIK): void => {
    if (!c.enabled || c.target === null || c.weight <= 0) return;
    const rootT = world.getComponent(c.root, Transform);
    const midT = world.getComponent(c.mid, Transform);
    if (rootT === undefined || midT === undefined) return;

    // Positions + world rotations from the propagated pose.
    if (!readWorldPos(c.root, rootPos)) return;
    if (!readWorldPos(c.mid, midPos)) return;
    if (!readWorldPos(c.tip, tipPos)) return;
    if (!readWorldPos(c.target, targetPos)) return;
    if (!readWorldRot(c.root, rootWorldRot)) return;
    if (!readWorldRot(c.mid, midWorldRot)) return;
    readParentWorldRot(c.root, parentWorldRot);

    let pole: Vec3 | null = null;
    if (c.pole !== null && readWorldPos(c.pole, polePos)) pole = polePos;

    quat.copy(rootT.rotation, fkRoot);
    quat.copy(midT.rotation, fkMid);

    solveTwoBone(
      {
        rootPos,
        midPos,
        tipPos,
        targetPos,
        polePos: pole,
        rootWorldRot,
        midWorldRot,
        rootParentWorldRot: parentWorldRot,
      },
      twoBoneOut,
    );

    writeBlended(c.root, fkRoot, twoBoneOut.rootLocalRot, c.weight);
    writeBlended(c.mid, fkMid, twoBoneOut.midLocalRot, c.weight);

    // Optionally orient the tip toward the target's rotation (planted foot/hand).
    if (c.targetRotationWeight > 0) {
      const tipT = world.getComponent(c.tip, Transform);
      if (tipT !== undefined && readWorldRot(c.tip, tipWorldCur) && readWorldRot(c.target, targetRot)) {
        quat.slerp(tipWorldCur, targetRot, c.targetRotationWeight, tipWorldIk);
        quat.inverse(twoBoneOut.midWorldRot, invMid);
        quat.multiply(invMid, tipWorldIk, tipLocalIk);
        quat.copy(tipT.rotation, fkTip);
        writeBlended(c.tip, fkTip, tipLocalIk, c.weight);
      }
    }

    recomputeWorldSubtree(world, c.root);
  };

  const solveChainConstraint = (c: IkChain): void => {
    if (!c.enabled || c.target === null || c.weight <= 0) return;
    const n = c.joints.length;
    if (n < 2) return;
    ensureChain(n);
    for (let i = 0; i < n; i++) {
      const joint = c.joints[i]!;
      if (!readWorldPos(joint, chainPos[i]!)) return;
      if (!readWorldRot(joint, chainRot[i]!)) return;
    }
    if (!readWorldPos(c.target, targetPos)) return;
    readParentWorldRot(c.joints[0]!, parentWorldRot);

    for (let i = 0; i < n - 1; i++) {
      const t = world.getComponent(c.joints[i]!, Transform);
      if (t === undefined) return;
      quat.copy(t.rotation, chainFk[i]!);
    }

    chainPosView.length = 0;
    chainRotView.length = 0;
    for (let i = 0; i < n; i++) {
      chainPosView.push(chainPos[i]!);
      chainRotView.push(chainRot[i]!);
    }
    solveCcd(
      {
        jointWorldPos: chainPosView,
        jointWorldRot: chainRotView,
        rootParentWorldRot: parentWorldRot,
        targetPos,
        iterations: c.iterations,
        tolerance: c.tolerance,
      },
      chainOut,
    );

    for (let i = 0; i < n - 1; i++) {
      writeBlended(c.joints[i]!, chainFk[i]!, chainOut[i]!, c.weight);
    }
    recomputeWorldSubtree(world, c.joints[0]!);
  };

  const solveLookAtConstraint = (c: LookAtConstraint): void => {
    if (!c.enabled || c.target === null || c.weight <= 0) return;
    const boneT = world.getComponent(c.bone, Transform);
    if (boneT === undefined) return;
    if (!readWorldPos(c.bone, worldPos)) return;
    if (!readWorldRot(c.bone, rootWorldRot)) return;
    if (!readWorldPos(c.target, targetPos)) return;
    readParentWorldRot(c.bone, parentWorldRot);

    solveAim(
      {
        bonePos: worldPos,
        boneWorldRot: rootWorldRot,
        boneParentWorldRot: parentWorldRot,
        targetPos,
        aimAxis: c.aimAxis,
        upAxis: c.upAxis,
        worldUp: c.worldUp,
      },
      aimOut,
    );
    quat.copy(boneT.rotation, fkBone);
    writeBlended(c.bone, fkBone, aimOut, c.weight);
    recomputeWorldSubtree(world, c.bone);
  };

  interface PendingSolve {
    readonly order: number;
    run(): void;
  }
  const pending: PendingSolve[] = [];

  app.addSystem(
    'postUpdate',
    [Query([TwoBoneIK]), Query([IkChain]), Query([LookAtConstraint])],
    (twoBones, chains, looks) => {
      pending.length = 0;
      for (const [, c] of twoBones.entries()) pending.push({ order: c.order, run: () => solveTwoBoneConstraint(c) });
      for (const [, c] of chains.entries()) pending.push({ order: c.order, run: () => solveChainConstraint(c) });
      for (const [, c] of looks.entries()) pending.push({ order: c.order, run: () => solveLookAtConstraint(c) });
      if (pending.length === 0) return;
      pending.sort((a, b) => a.order - b.order);
      for (const p of pending) p.run();
    },
    { name: 'ik-solve', after: ['transform-propagation'], before: ['skinning-compute-palettes'] },
  );
};
