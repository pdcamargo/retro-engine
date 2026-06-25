import type { Pose } from './pose';

/**
 * Per-slot inclusion for a layer: `mask[slot] !== 0` means the layer may write
 * that bone. `undefined` means "every bone" (an unmasked layer). Built once per
 * layer per frame from an {@link import('./avatar-mask').AvatarMask} and the
 * frame's slot layout.
 */
export type LayerMask = Uint8Array | undefined;

const included = (mask: LayerMask, slot: number): boolean => mask === undefined || mask[slot] !== 0;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * Sign-aligned nlerp from accumulator quaternion `acc.r[slot]` toward
 * `lp.r[slot]` by `t`, written back into `acc.r[slot]`. Mirrors the hemisphere
 * handling in {@link import('./pose-blend').accumulateRotation}: the source is
 * negated when its dot with the destination is negative so the short arc is
 * taken, then the interpolated quaternion is renormalized.
 */
const nlerpRotation = (acc: Pose, lp: Pose, slot: number, t: number): void => {
  const i = slot * 4;
  const ax = acc.r[i]!;
  const ay = acc.r[i + 1]!;
  const az = acc.r[i + 2]!;
  const aw = acc.r[i + 3]!;
  let bx = lp.r[i]!;
  let by = lp.r[i + 1]!;
  let bz = lp.r[i + 2]!;
  let bw = lp.r[i + 3]!;
  if (ax * bx + ay * by + az * bz + aw * bw < 0) {
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  let x = lerp(ax, bx, t);
  let y = lerp(ay, by, t);
  let z = lerp(az, bz, t);
  let w = lerp(aw, bw, t);
  const len = Math.hypot(x, y, z, w);
  if (len > 0) {
    x /= len;
    y /= len;
    z /= len;
    w /= len;
  } else {
    x = 0;
    y = 0;
    z = 0;
    w = 1;
  }
  acc.r[i] = x;
  acc.r[i + 1] = y;
  acc.r[i + 2] = z;
  acc.r[i + 3] = w;
};

/**
 * Override-blend a finalized layer pose `lp` onto the accumulator `acc` with
 * `weight`, restricted to the bones `mask` includes. Per masked bone and per
 * field the layer actually animates (`lp.w* > 0`): if the accumulator already
 * has a value there it moves `lerp(acc, lp, weight)` toward the layer (nlerp for
 * rotation); otherwise — nothing below it animated that bone — it takes the
 * layer value outright. Masked-out or layer-untouched fields keep the
 * accumulator unchanged, so a lower layer shows through wherever the upper one
 * does not write. This is the Unity "Override" layer-blend mode.
 */
export const composeLayerOverride = (
  acc: Pose,
  lp: Pose,
  weight: number,
  mask: LayerMask,
): void => {
  if (weight <= 0) return;
  const n = acc.jointCount;
  for (let slot = 0; slot < n; slot++) {
    if (!included(mask, slot)) continue;
    const i3 = slot * 3;
    if (lp.wt[slot]! > 0) {
      if (acc.wt[slot]! > 0) {
        acc.t[i3] = lerp(acc.t[i3]!, lp.t[i3]!, weight);
        acc.t[i3 + 1] = lerp(acc.t[i3 + 1]!, lp.t[i3 + 1]!, weight);
        acc.t[i3 + 2] = lerp(acc.t[i3 + 2]!, lp.t[i3 + 2]!, weight);
      } else {
        acc.t[i3] = lp.t[i3]!;
        acc.t[i3 + 1] = lp.t[i3 + 1]!;
        acc.t[i3 + 2] = lp.t[i3 + 2]!;
      }
      acc.wt[slot] = 1;
    }
    if (lp.wr[slot]! > 0) {
      if (acc.wr[slot]! > 0) {
        nlerpRotation(acc, lp, slot, weight);
      } else {
        const i4 = slot * 4;
        acc.r[i4] = lp.r[i4]!;
        acc.r[i4 + 1] = lp.r[i4 + 1]!;
        acc.r[i4 + 2] = lp.r[i4 + 2]!;
        acc.r[i4 + 3] = lp.r[i4 + 3]!;
      }
      acc.wr[slot] = 1;
    }
    if (lp.ws[slot]! > 0) {
      if (acc.ws[slot]! > 0) {
        acc.s[i3] = lerp(acc.s[i3]!, lp.s[i3]!, weight);
        acc.s[i3 + 1] = lerp(acc.s[i3 + 1]!, lp.s[i3 + 1]!, weight);
        acc.s[i3 + 2] = lerp(acc.s[i3 + 2]!, lp.s[i3 + 2]!, weight);
      } else {
        acc.s[i3] = lp.s[i3]!;
        acc.s[i3 + 1] = lp.s[i3 + 1]!;
        acc.s[i3 + 2] = lp.s[i3 + 2]!;
      }
      acc.ws[slot] = 1;
    }
  }
};

/**
 * Additive-blend a finalized layer pose `lp` onto the accumulator `acc` with
 * `weight`, restricted to the bones `mask` includes. The layer pose carries
 * *absolute* local transforms; the delta against the `reference` (rest/bind)
 * pose is what gets added:
 *
 * - translation: `acc += weight · (lp − reference)`
 * - rotation: `acc = acc · nlerp(identity, reference⁻¹ · lp, weight)`
 * - scale: `acc *= lerp(1, lp / reference, weight)`
 *
 * When nothing below animated a bone the reference pose stands in as the base,
 * so an additive layer over an otherwise-static bone reads as the reference plus
 * the weighted delta. Only fields the layer animates and the mask includes are
 * touched. This is the Unity "Additive" layer-blend mode.
 */
export const composeLayerAdditive = (
  acc: Pose,
  lp: Pose,
  reference: Pose,
  weight: number,
  mask: LayerMask,
): void => {
  if (weight <= 0) return;
  const n = acc.jointCount;
  for (let slot = 0; slot < n; slot++) {
    if (!included(mask, slot)) continue;
    const i3 = slot * 3;
    const i4 = slot * 4;

    if (lp.wt[slot]! > 0 && reference.wt[slot]! > 0) {
      const base0 = acc.wt[slot]! > 0 ? acc.t[i3]! : reference.t[i3]!;
      const base1 = acc.wt[slot]! > 0 ? acc.t[i3 + 1]! : reference.t[i3 + 1]!;
      const base2 = acc.wt[slot]! > 0 ? acc.t[i3 + 2]! : reference.t[i3 + 2]!;
      acc.t[i3] = base0 + weight * (lp.t[i3]! - reference.t[i3]!);
      acc.t[i3 + 1] = base1 + weight * (lp.t[i3 + 1]! - reference.t[i3 + 1]!);
      acc.t[i3 + 2] = base2 + weight * (lp.t[i3 + 2]! - reference.t[i3 + 2]!);
      acc.wt[slot] = 1;
    }

    if (lp.wr[slot]! > 0 && reference.wr[slot]! > 0) {
      // delta = reference⁻¹ · lp (unit reference ⇒ inverse is the conjugate).
      const rx = -reference.r[i4]!;
      const ry = -reference.r[i4 + 1]!;
      const rz = -reference.r[i4 + 2]!;
      const rw = reference.r[i4 + 3]!;
      const lx = lp.r[i4]!;
      const ly = lp.r[i4 + 1]!;
      const lz = lp.r[i4 + 2]!;
      const lw = lp.r[i4 + 3]!;
      let dx = rw * lx + rx * lw + ry * lz - rz * ly;
      let dy = rw * ly - rx * lz + ry * lw + rz * lx;
      let dz = rw * lz + rx * ly - ry * lx + rz * lw;
      let dw = rw * lw - rx * lx - ry * ly - rz * lz;
      // Scale the delta from identity by weight (sign-aligned nlerp toward identity).
      if (dw < 0) {
        dx = -dx;
        dy = -dy;
        dz = -dz;
        dw = -dw;
      }
      let wx = weight * dx;
      let wy = weight * dy;
      let wz = weight * dz;
      let ww = 1 - weight + weight * dw;
      const dlen = Math.hypot(wx, wy, wz, ww);
      if (dlen > 0) {
        wx /= dlen;
        wy /= dlen;
        wz /= dlen;
        ww /= dlen;
      } else {
        wx = 0;
        wy = 0;
        wz = 0;
        ww = 1;
      }
      const bx = acc.wr[slot]! > 0 ? acc.r[i4]! : reference.r[i4]!;
      const by = acc.wr[slot]! > 0 ? acc.r[i4 + 1]! : reference.r[i4 + 1]!;
      const bz = acc.wr[slot]! > 0 ? acc.r[i4 + 2]! : reference.r[i4 + 2]!;
      const bw = acc.wr[slot]! > 0 ? acc.r[i4 + 3]! : reference.r[i4 + 3]!;
      // acc = base · weightedDelta (Hamilton product).
      acc.r[i4] = bw * wx + bx * ww + by * wz - bz * wy;
      acc.r[i4 + 1] = bw * wy - bx * wz + by * ww + bz * wx;
      acc.r[i4 + 2] = bw * wz + bx * wy - by * wx + bz * ww;
      acc.r[i4 + 3] = bw * ww - bx * wx - by * wy - bz * wz;
      acc.wr[slot] = 1;
    }

    if (lp.ws[slot]! > 0 && reference.ws[slot]! > 0) {
      const ref0 = reference.s[i3]!;
      const ref1 = reference.s[i3 + 1]!;
      const ref2 = reference.s[i3 + 2]!;
      const f0 = ref0 !== 0 ? lerp(1, lp.s[i3]! / ref0, weight) : 1;
      const f1 = ref1 !== 0 ? lerp(1, lp.s[i3 + 1]! / ref1, weight) : 1;
      const f2 = ref2 !== 0 ? lerp(1, lp.s[i3 + 2]! / ref2, weight) : 1;
      const base0 = acc.ws[slot]! > 0 ? acc.s[i3]! : ref0;
      const base1 = acc.ws[slot]! > 0 ? acc.s[i3 + 1]! : ref1;
      const base2 = acc.ws[slot]! > 0 ? acc.s[i3 + 2]! : ref2;
      acc.s[i3] = base0 * f0;
      acc.s[i3 + 1] = base1 * f1;
      acc.s[i3 + 2] = base2 * f2;
      acc.ws[slot] = 1;
    }
  }
};

