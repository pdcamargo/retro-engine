import type { Entity } from '@retro-engine/ecs';
import type { Vec3 } from '@retro-engine/math';
import { vec3 } from '@retro-engine/math';

/**
 * Two-bone (limb) IK constraint. Solves a root → mid → tip chain — a shoulder /
 * elbow / hand or hip / knee / ankle — so the tip reaches `target`, bending the
 * mid joint toward `pole`. Runs as a post-pass after the FK pose is committed
 * and world transforms are propagated; the result blends over the FK pose by
 * `weight`.
 *
 * The chain must be direct: `mid` is the parent of `tip` and `root` is the
 * parent of `mid`.
 */
export class TwoBoneIK {
  constructor(
    /** Root joint of the limb (shoulder / hip). */
    public root: Entity = 0 as Entity,
    /** Mid joint that bends (elbow / knee). */
    public mid: Entity = 0 as Entity,
    /** Tip joint driven to the target (hand / ankle). */
    public tip: Entity = 0 as Entity,
    /**
     * Entity whose world position the tip reaches. `null` disables the
     * constraint. Parent or animate it to drive the limb.
     */
    public target: Entity | null = null,
    /**
     * Entity whose world position pulls the mid joint, fixing the bend plane
     * (the knee/elbow direction). `null` keeps the current FK bend.
     */
    public pole: Entity | null = null,
    /** Blend of the IK result over the FK pose, `0` (FK) … `1` (full IK). */
    public weight = 1,
    /**
     * How strongly the tip adopts the target's orientation, `0` … `1` — for a
     * planted foot or a hand gripping a fixed pose.
     */
    public targetRotationWeight = 0,
    /** When `false` the constraint is skipped entirely. */
    public enabled = true,
    /** Solve order among constraints on the same rig; lower runs first. */
    public order = 0,
  ) {}
}

/**
 * N-bone IK constraint solved with Cyclic Coordinate Descent. `joints` runs root
 * → tip as a direct parent chain (each joint is the parent of the next); the
 * last joint is the end effector driven to `target`. Suits spines, tails, and
 * other longer chains a two-bone solver cannot express. The result blends over
 * the FK pose by `weight`.
 */
export class IkChain {
  constructor(
    /** Ordered joints, root → tip; the last is the end effector. */
    public joints: Entity[] = [],
    /** Entity whose world position the end effector reaches. `null` disables it. */
    public target: Entity | null = null,
    /** Maximum CCD sweeps per frame. */
    public iterations = 10,
    /** Stop once the end effector is within this distance of the target. */
    public tolerance = 0.001,
    /** Blend of the IK result over the FK pose, `0` (FK) … `1` (full IK). */
    public weight = 1,
    /** When `false` the constraint is skipped entirely. */
    public enabled = true,
    /** Solve order among constraints on the same rig; lower runs first. */
    public order = 0,
  ) {}
}

/**
 * Look-at / aim constraint. Rotates `bone` so its local `aimAxis` points at
 * `target`, rolling about that axis so `upAxis` lines up with `worldUp`. Use it
 * for heads, eyes, gun barrels, or turrets. The result blends over the FK pose
 * by `weight`.
 */
export class LookAtConstraint {
  constructor(
    /** The bone to rotate. */
    public bone: Entity = 0 as Entity,
    /** Entity whose world position the bone aims at. `null` disables it. */
    public target: Entity | null = null,
    /** Local axis of the bone that points at the target. Defaults to +Z. */
    public aimAxis: Vec3 = vec3.create(0, 0, 1),
    /** Local axis kept toward `worldUp` to control the twist. Defaults to +Y. */
    public upAxis: Vec3 = vec3.create(0, 1, 0),
    /** World-space reference up the twist aligns `upAxis` with. Defaults to +Y. */
    public worldUp: Vec3 = vec3.create(0, 1, 0),
    /** Blend of the IK result over the FK pose, `0` (FK) … `1` (full IK). */
    public weight = 1,
    /** When `false` the constraint is skipped entirely. */
    public enabled = true,
    /** Solve order among constraints on the same rig; lower runs first. */
    public order = 0,
  ) {}
}
