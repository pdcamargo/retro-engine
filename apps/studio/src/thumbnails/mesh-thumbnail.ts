import { type Mesh, MeshAttribute } from '@retro-engine/engine';

/** A unit-length light direction in view space (upper-right, toward the viewer). */
const LIGHT = ((): readonly [number, number, number] => {
  const v: [number, number, number] = [0.4, 0.7, 0.65];
  const m = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / m, v[1] / m, v[2] / m];
})();

const BASE_COLOR: readonly [number, number, number] = [0.45, 0.78, 0.55];
const AMBIENT = 0.28;

/**
 * Render a mesh to a flat-shaded `size`×`size` RGBA8 preview on the CPU — a fixed
 * 3/4 orthographic view, per-face flat shading, painter-sorted back-to-front with
 * backface culling. Cheap and self-contained (no GPU pass): it reuses the same
 * canvas → texture upload as image thumbnails. A GPU PBR render is the eventual
 * quality upgrade (tracked in the thumbnail backlog).
 */
export const renderMeshThumbnail = (mesh: Mesh, size: number): Uint8Array => {
  const pos = mesh.getAttribute(MeshAttribute.POSITION);
  if (pos === undefined || !(pos.data instanceof Float32Array)) {
    throw new Error('mesh has no Float32Array POSITION attribute');
  }
  const p = pos.data;
  const index = mesh.indices?.data;
  const triCount = index !== undefined ? Math.floor(index.length / 3) : Math.floor(p.length / 9);

  const aabb = mesh.computeAabb();
  const cx = aabb.center[0]!;
  const cy = aabb.center[1]!;
  const cz = aabb.center[2]!;
  const radius = Math.max(aabb.halfExtents[0]!, aabb.halfExtents[1]!, aabb.halfExtents[2]!) || 1;
  const norm = 0.5 / radius;

  // 3/4 view: yaw around Y, then pitch around X. View space is x-right, y-up,
  // z-toward-viewer, so a face is front-facing when its normal's z > 0.
  const yaw = 0.7;
  const pitch = 0.5;
  const cyaw = Math.cos(yaw);
  const syaw = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const view = (vi: number): [number, number, number] => {
    const x = (p[vi * 3]! - cx) * norm;
    const y = (p[vi * 3 + 1]! - cy) * norm;
    const z = (p[vi * 3 + 2]! - cz) * norm;
    const x1 = x * cyaw + z * syaw;
    const z1 = -x * syaw + z * cyaw;
    const y2 = y * cp - z1 * sp;
    const z2 = y * sp + z1 * cp;
    return [x1, y2, z2];
  };

  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('OffscreenCanvas 2D context unavailable');
  ctx.fillStyle = '#1b2422';
  ctx.fillRect(0, 0, size, size);

  const half = size / 2;
  const scale = size * 0.42;
  const sx = (vx: number): number => half + vx * scale;
  const sy = (vy: number): number => half - vy * scale;

  interface Face {
    readonly depth: number;
    readonly pts: readonly [number, number][];
    readonly fill: string;
  }
  const faces: Face[] = [];
  for (let t = 0; t < triCount; t += 1) {
    const ia = index !== undefined ? index[t * 3]! : t * 3;
    const ib = index !== undefined ? index[t * 3 + 1]! : t * 3 + 1;
    const ic = index !== undefined ? index[t * 3 + 2]! : t * 3 + 2;
    const a = view(ia);
    const b = view(ib);
    const c = view(ic);
    const e1x = b[0] - a[0];
    const e1y = b[1] - a[1];
    const e1z = b[2] - a[2];
    const e2x = c[0] - a[0];
    const e2y = c[1] - a[1];
    const e2z = c[2] - a[2];
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl;
    ny /= nl;
    nz /= nl;
    if (nz <= 0) continue; // backface
    const diffuse = Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
    const shade = Math.min(1, AMBIENT + diffuse * 0.85);
    const fill = `rgb(${Math.round(BASE_COLOR[0] * shade * 255)},${Math.round(BASE_COLOR[1] * shade * 255)},${Math.round(BASE_COLOR[2] * shade * 255)})`;
    faces.push({
      depth: (a[2] + b[2] + c[2]) / 3,
      pts: [
        [sx(a[0]), sy(a[1])],
        [sx(b[0]), sy(b[1])],
        [sx(c[0]), sy(c[1])],
      ],
      fill,
    });
  }

  faces.sort((l, r) => l.depth - r.depth); // back to front
  for (const face of faces) {
    ctx.beginPath();
    ctx.moveTo(face.pts[0]![0], face.pts[0]![1]);
    ctx.lineTo(face.pts[1]![0], face.pts[1]![1]);
    ctx.lineTo(face.pts[2]![0], face.pts[2]![1]);
    ctx.closePath();
    ctx.fillStyle = face.fill;
    ctx.fill();
  }

  return new Uint8Array(ctx.getImageData(0, 0, size, size).data.buffer);
};
