import { quat } from '@retro-engine/math';

import type { PropertyRenderer } from './property-types';
import { propertyRow, scrub } from './renderers-support';

const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;
const clamp1 = (v: number): number => Math.max(-1, Math.min(1, v));

/**
 * Quaternion → intrinsic XYZ Euler angles (radians) — the exact inverse of the
 * engine's `quat.fromEuler(x, y, z, 'xyz')`, so the angles shown match the ones
 * an author passes to `fromEuler` and round-trip without perturbing the rotation.
 */
const quatToEuler = (q: Float32Array): [number, number, number] => {
  const x = q[0] ?? 0;
  const y = q[1] ?? 0;
  const z = q[2] ?? 0;
  const w = q[3] ?? 1;
  const m13 = 2 * (x * z + w * y);
  const ry = Math.asin(clamp1(m13));
  if (Math.abs(m13) < 0.9999999) {
    const rx = Math.atan2(-2 * (y * z - w * x), 1 - 2 * (x * x + y * y));
    const rz = Math.atan2(-2 * (x * y - w * z), 1 - 2 * (y * y + z * z));
    return [rx, ry, rz];
  }
  // Gimbal lock (pitch ±90°): fold roll into yaw.
  return [Math.atan2(2 * (y * z + w * x), 1 - 2 * (x * x + z * z)), ry, 0];
};

const eulerToQuat = (rx: number, ry: number, rz: number): Float32Array =>
  quat.fromEuler(rx, ry, rz, 'xyz', new Float32Array(4));

const AXES = ['x', 'y', 'z'] as const;

/**
 * Render a quaternion as three Euler-angle fields (degrees, intrinsic XYZ). Edits
 * recompose the whole quaternion, so the three axes move together. Opt into this
 * with a `'euler'` widget hint (schema `.meta({ widget: 'euler' })` or an editor
 * amendment). Euler editing is ambiguous at gimbal lock — expected and shared by
 * every euler inspector.
 */
export const quatEulerRenderer: PropertyRenderer = (ctx) => {
  const q = ctx.value as Float32Array;
  const euler = quatToEuler(q);
  const deg: [number, number, number] = [euler[0] * RAD2DEG, euler[1] * RAD2DEG, euler[2] * RAD2DEG];
  propertyRow(ctx, () => {
    const gap = 4;
    const avail = ctx.ui.contentAvail()[0];
    const chip = Math.round(ctx.ui.frameHeight() * 0.82);
    const fieldW = Math.max(18, (avail - gap * 2 - chip * 3) / 3);
    const edit = ctx.edit.scalar(ctx.path, q);
    ctx.ui.withDisabled(ctx.readonly, () => {
      let changed = false;
      let deactivated = false;
      for (let i = 0; i < 3; i++) {
        if (i > 0) ctx.ui.sameLine(0, gap);
        const current = deg[i] ?? 0;
        const next = ctx.widgets.dragNumber(`${ctx.id}-e${String(i)}`, current, {
          axis: AXES[i],
          step: 1,
          suffix: '°',
          width: fieldW,
        });
        if (ctx.ui.itemEdges().deactivatedAfterEdit) deactivated = true;
        if (next !== current) {
          deg[i] = next;
          changed = true;
        }
      }
      if (ctx.readonly) return;
      if (changed) edit.preview(eulerToQuat(deg[0] * DEG2RAD, deg[1] * DEG2RAD, deg[2] * DEG2RAD));
      if (deactivated) edit.sync({ activated: false, deactivatedAfterEdit: true, edited: true });
    });
  });
};

/**
 * Render a quaternion as a single 2D rotation angle (degrees about +Z). Editing
 * writes a pure-Z quaternion, constraining the rotation to the 2D plane. Opt in
 * with an `'angle2d'` widget hint — intended for 2D content.
 */
export const quatAngle2dRenderer: PropertyRenderer = (ctx) => {
  const q = ctx.value as Float32Array;
  const angleDeg = 2 * Math.atan2(q[2] ?? 0, q[3] ?? 1) * RAD2DEG;
  propertyRow(ctx, () => {
    scrub(ctx, ctx.path, q, () => {
      const next = ctx.widgets.dragNumber(ctx.id, angleDeg, {
        axis: 'z',
        step: 1,
        suffix: '°',
        width: ctx.ui.contentAvail()[0],
      });
      if (next === angleDeg) return q;
      const half = next * DEG2RAD * 0.5;
      const nq = new Float32Array(4);
      nq[2] = Math.sin(half);
      nq[3] = Math.cos(half);
      return nq;
    });
  });
};
