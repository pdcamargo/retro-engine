import type { Color, Quat, Vec3 } from '@retro-engine/math';

import { DEFAULT_GIZMO_MASK } from './gizmo-layers';

/** Per-call overrides for which view sees a gizmo and whether it is occluded. */
export interface GizmoDrawOptions {
  /**
   * Render-layer mask: a camera draws this gizmo only when its own mask shares
   * a bit. Defaults to {@link Gizmos.defaultLayerMask}.
   */
  readonly layer?: number;
  /**
   * When `true` (the default), the gizmo is occluded by scene geometry it is
   * behind. When `false` it draws always-on-top — the right choice for
   * interactive handles that must stay grabbable.
   */
  readonly depthTest?: boolean;
}

const FLOATS_PER_SEGMENT_POS = 6;
const FLOATS_PER_SEGMENT_COLOR = 8;
const INITIAL_SEGMENTS = 256;

// Scratch basis vectors reused by ring/box helpers so a draw call allocates nothing.
const tmpU = new Float32Array(3);
const tmpV = new Float32Array(3);

/**
 * Immediate-mode, world-space debug-line buffer.
 *
 * Inserted as a resource by {@link GizmoPlugin}; obtain it in a system via
 * `ResMut(Gizmos)` and call the drawing methods each frame. The buffer renders
 * exactly the segments pushed this frame and is cleared automatically once the
 * frame's render pass has run, so a gizmo persists only while its draw call is
 * issued — there is no handle to retain or remove.
 *
 * Every shape decomposes to line segments. Lines are 1px (hardware
 * `line-list`); width is not yet configurable.
 *
 * @example
 * ```ts
 * app.addSystem('update', [ResMut(Gizmos)], (gizmos) => {
 *   gizmos.line(vec3.create(0, 0, 0), vec3.create(0, 2, 0), Colors.white);
 *   gizmos.sphere(playerPos, 0.5, color(1, 0, 0, 1));
 * });
 * ```
 */
export class Gizmos {
  /** Render-layer mask applied to draws that don't override it. */
  defaultLayerMask: number = DEFAULT_GIZMO_MASK;

  /** Depth-test flag applied to draws that don't override it. */
  defaultDepthTest = true;

  /** Segment count pushed this frame. */
  count = 0;

  /** Interleaved endpoints: `[ax, ay, az, bx, by, bz]` per segment. */
  positions: Float32Array = new Float32Array(INITIAL_SEGMENTS * FLOATS_PER_SEGMENT_POS);

  /** Interleaved endpoint colors: `[ra,ga,ba,aa, rb,gb,bb,ab]` per segment. */
  colors: Float32Array = new Float32Array(INITIAL_SEGMENTS * FLOATS_PER_SEGMENT_COLOR);

  /** Render-layer mask per segment. */
  layerMask: Uint32Array = new Uint32Array(INITIAL_SEGMENTS);

  /** `1` = depth-tested, `0` = always-on-top, per segment. */
  depthFlags: Uint8Array = new Uint8Array(INITIAL_SEGMENTS);

  /** Discard every segment pushed this frame. Called by the engine after rendering. */
  clear(): void {
    this.count = 0;
  }

  /**
   * Push one line segment from `(ax, ay, az)` to `(bx, by, bz)` with separate
   * endpoint colors. The lowest-level entry point — every other method funnels
   * here. Grows the backing arrays on demand.
   */
  pushSegment(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    ca: Color,
    cb: Color,
    layerMask: number,
    depthTest: boolean,
  ): void {
    const i = this.count;
    if (i >= this.layerMask.length) this.grow();
    const p = i * FLOATS_PER_SEGMENT_POS;
    this.positions[p] = ax;
    this.positions[p + 1] = ay;
    this.positions[p + 2] = az;
    this.positions[p + 3] = bx;
    this.positions[p + 4] = by;
    this.positions[p + 5] = bz;
    const c = i * FLOATS_PER_SEGMENT_COLOR;
    this.colors[c] = ca.r;
    this.colors[c + 1] = ca.g;
    this.colors[c + 2] = ca.b;
    this.colors[c + 3] = ca.a;
    this.colors[c + 4] = cb.r;
    this.colors[c + 5] = cb.g;
    this.colors[c + 6] = cb.b;
    this.colors[c + 7] = cb.a;
    this.layerMask[i] = layerMask;
    this.depthFlags[i] = depthTest ? 1 : 0;
    this.count = i + 1;
  }

  /** A line segment from `a` to `b` in a single color. */
  line(a: Vec3, b: Vec3, color: Color, opts?: GizmoDrawOptions): void {
    this.lineGradient(a, b, color, color, opts);
  }

  /** A line segment whose color interpolates from `colorA` at `a` to `colorB` at `b`. */
  lineGradient(a: Vec3, b: Vec3, colorA: Color, colorB: Color, opts?: GizmoDrawOptions): void {
    this.pushSegment(
      a[0]!,
      a[1]!,
      a[2]!,
      b[0]!,
      b[1]!,
      b[2]!,
      colorA,
      colorB,
      opts?.layer ?? this.defaultLayerMask,
      opts?.depthTest ?? this.defaultDepthTest,
    );
  }

  /** A ray drawn as a segment from `origin` extending along `dir` (length = `|dir|`). */
  ray(origin: Vec3, dir: Vec3, color: Color, opts?: GizmoDrawOptions): void {
    this.pushSegment(
      origin[0]!,
      origin[1]!,
      origin[2]!,
      origin[0]! + dir[0]!,
      origin[1]! + dir[1]!,
      origin[2]! + dir[2]!,
      color,
      color,
      opts?.layer ?? this.defaultLayerMask,
      opts?.depthTest ?? this.defaultDepthTest,
    );
  }

  /** A circle of `radius` centered at `center`, lying in the plane with the given `normal`. */
  circle(
    center: Vec3,
    normal: Vec3,
    radius: number,
    color: Color,
    segments = 32,
    opts?: GizmoDrawOptions,
  ): void {
    this.arc(center, normal, radius, 0, Math.PI * 2, color, segments, opts);
  }

  /**
   * An arc of `radius` centered at `center`, in the plane with the given
   * `normal`, sweeping `sweep` radians from `startAngle`. Used for rotation-gizmo
   * dials.
   */
  arc(
    center: Vec3,
    normal: Vec3,
    radius: number,
    startAngle: number,
    sweep: number,
    color: Color,
    segments = 32,
    opts?: GizmoDrawOptions,
  ): void {
    orthonormalBasis(normal, tmpU, tmpV);
    const ux = tmpU[0]!;
    const uy = tmpU[1]!;
    const uz = tmpU[2]!;
    const vx = tmpV[0]!;
    const vy = tmpV[1]!;
    const vz = tmpV[2]!;
    const cx = center[0]!;
    const cy = center[1]!;
    const cz = center[2]!;
    const layer = opts?.layer ?? this.defaultLayerMask;
    const depth = opts?.depthTest ?? this.defaultDepthTest;
    const step = sweep / segments;
    let prevA = startAngle;
    let px = cx + radius * (Math.cos(prevA) * ux + Math.sin(prevA) * vx);
    let py = cy + radius * (Math.cos(prevA) * uy + Math.sin(prevA) * vy);
    let pz = cz + radius * (Math.cos(prevA) * uz + Math.sin(prevA) * vz);
    for (let s = 1; s <= segments; s++) {
      const ang = startAngle + step * s;
      const nx = cx + radius * (Math.cos(ang) * ux + Math.sin(ang) * vx);
      const ny = cy + radius * (Math.cos(ang) * uy + Math.sin(ang) * vy);
      const nz = cz + radius * (Math.cos(ang) * uz + Math.sin(ang) * vz);
      this.pushSegment(px, py, pz, nx, ny, nz, color, color, layer, depth);
      px = nx;
      py = ny;
      pz = nz;
      prevA = ang;
    }
  }

  /** A wireframe sphere of `radius` at `center`, drawn as three orthogonal great circles. */
  sphere(center: Vec3, radius: number, color: Color, segments = 24, opts?: GizmoDrawOptions): void {
    this.circle(center, X_AXIS, radius, color, segments, opts);
    this.circle(center, Y_AXIS, radius, color, segments, opts);
    this.circle(center, Z_AXIS, radius, color, segments, opts);
  }

  /**
   * A wireframe box of half-extents `halfExtents` at `center`, optionally
   * oriented by `rotation`. Twelve edges.
   */
  cuboid(
    center: Vec3,
    halfExtents: Vec3,
    color: Color,
    rotation?: Quat,
    opts?: GizmoDrawOptions,
  ): void {
    const hx = halfExtents[0]!;
    const hy = halfExtents[1]!;
    const hz = halfExtents[2]!;
    // Eight corners, sign per axis.
    const corner = (sx: number, sy: number, sz: number, out: Float32Array): void => {
      let x = sx * hx;
      let y = sy * hy;
      let z = sz * hz;
      if (rotation !== undefined) {
        const r = rotateVec(x, y, z, rotation);
        x = r[0];
        y = r[1];
        z = r[2];
      }
      out[0] = center[0]! + x;
      out[1] = center[1]! + y;
      out[2] = center[2]! + z;
    };
    const c000 = new Float32Array(3);
    const c001 = new Float32Array(3);
    const c010 = new Float32Array(3);
    const c011 = new Float32Array(3);
    const c100 = new Float32Array(3);
    const c101 = new Float32Array(3);
    const c110 = new Float32Array(3);
    const c111 = new Float32Array(3);
    corner(-1, -1, -1, c000);
    corner(-1, -1, 1, c001);
    corner(-1, 1, -1, c010);
    corner(-1, 1, 1, c011);
    corner(1, -1, -1, c100);
    corner(1, -1, 1, c101);
    corner(1, 1, -1, c110);
    corner(1, 1, 1, c111);
    // 4 edges along X, 4 along Y, 4 along Z.
    this.line(c000, c100, color, opts);
    this.line(c001, c101, color, opts);
    this.line(c010, c110, color, opts);
    this.line(c011, c111, color, opts);
    this.line(c000, c010, color, opts);
    this.line(c001, c011, color, opts);
    this.line(c100, c110, color, opts);
    this.line(c101, c111, color, opts);
    this.line(c000, c001, color, opts);
    this.line(c010, c011, color, opts);
    this.line(c100, c101, color, opts);
    this.line(c110, c111, color, opts);
  }

  /**
   * An arrow from `start` to `end`: a shaft plus a four-line conical head. The
   * head length defaults to a fifth of the shaft.
   */
  arrow(start: Vec3, end: Vec3, color: Color, headLength?: number, opts?: GizmoDrawOptions): void {
    this.line(start, end, color, opts);
    let dx = end[0]! - start[0]!;
    let dy = end[1]! - start[1]!;
    let dz = end[2]! - start[2]!;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return;
    dx /= len;
    dy /= len;
    dz /= len;
    const head = headLength ?? len * 0.2;
    // Build a basis around the arrow direction for the head spokes.
    basisFromDirection(dx, dy, dz, tmpU, tmpV);
    const baseX = end[0]! - dx * head;
    const baseY = end[1]! - dy * head;
    const baseZ = end[2]! - dz * head;
    const r = head * 0.4;
    for (let i = 0; i < 4; i++) {
      const sign1 = i < 2 ? 1 : -1;
      const useU = i % 2 === 0;
      const ox = (useU ? tmpU[0]! : tmpV[0]!) * r * sign1;
      const oy = (useU ? tmpU[1]! : tmpV[1]!) * r * sign1;
      const oz = (useU ? tmpU[2]! : tmpV[2]!) * r * sign1;
      this.pushSegment(
        end[0]!,
        end[1]!,
        end[2]!,
        baseX + ox,
        baseY + oy,
        baseZ + oz,
        color,
        color,
        opts?.layer ?? this.defaultLayerMask,
        opts?.depthTest ?? this.defaultDepthTest,
      );
    }
  }

  /**
   * The three coordinate axes at `origin`, each an arrow of `length`: X red, Y
   * green, Z blue. When `rotation` is given the axes follow that orientation
   * (e.g. an entity's local frame); otherwise they are world-aligned.
   */
  axes(origin: Vec3, rotation: Quat | undefined, length: number, opts?: GizmoDrawOptions): void {
    const ox = origin[0]!;
    const oy = origin[1]!;
    const oz = origin[2]!;
    const dir = (x: number, y: number, z: number): Float32Array => {
      if (rotation === undefined) return new Float32Array([ox + x, oy + y, oz + z]);
      const r = rotateVec(x, y, z, rotation);
      return new Float32Array([ox + r[0], oy + r[1], oz + r[2]]);
    };
    const o = new Float32Array([ox, oy, oz]);
    this.arrow(o, dir(length, 0, 0), AXIS_RED, undefined, opts);
    this.arrow(o, dir(0, length, 0), AXIS_GREEN, undefined, opts);
    this.arrow(o, dir(0, 0, length), AXIS_BLUE, undefined, opts);
  }

  /**
   * A rectangular grid centered at `center`, lying in the plane with the given
   * `normal`. `cells` is the count along each in-plane axis and `cellSize` the
   * spacing between lines.
   */
  grid(
    center: Vec3,
    normal: Vec3,
    cellsU: number,
    cellsV: number,
    cellSize: number,
    color: Color,
    opts?: GizmoDrawOptions,
  ): void {
    orthonormalBasis(normal, tmpU, tmpV);
    const ux = tmpU[0]!;
    const uy = tmpU[1]!;
    const uz = tmpU[2]!;
    const vx = tmpV[0]!;
    const vy = tmpV[1]!;
    const vz = tmpV[2]!;
    const cx = center[0]!;
    const cy = center[1]!;
    const cz = center[2]!;
    const halfU = (cellsU * cellSize) / 2;
    const halfV = (cellsV * cellSize) / 2;
    const a = new Float32Array(3);
    const b = new Float32Array(3);
    // Lines parallel to V (varying U).
    for (let i = 0; i <= cellsU; i++) {
      const u = -halfU + i * cellSize;
      a[0] = cx + ux * u - vx * halfV;
      a[1] = cy + uy * u - vy * halfV;
      a[2] = cz + uz * u - vz * halfV;
      b[0] = cx + ux * u + vx * halfV;
      b[1] = cy + uy * u + vy * halfV;
      b[2] = cz + uz * u + vz * halfV;
      this.line(a, b, color, opts);
    }
    // Lines parallel to U (varying V).
    for (let j = 0; j <= cellsV; j++) {
      const v = -halfV + j * cellSize;
      a[0] = cx + vx * v - ux * halfU;
      a[1] = cy + vy * v - uy * halfU;
      a[2] = cz + vz * v - uz * halfU;
      b[0] = cx + vx * v + ux * halfU;
      b[1] = cy + vy * v + uy * halfU;
      b[2] = cz + vz * v + uz * halfU;
      this.line(a, b, color, opts);
    }
  }

  private grow(): void {
    const segCap = this.layerMask.length;
    const next = segCap * 2;
    const pos = new Float32Array(next * FLOATS_PER_SEGMENT_POS);
    pos.set(this.positions);
    this.positions = pos;
    const col = new Float32Array(next * FLOATS_PER_SEGMENT_COLOR);
    col.set(this.colors);
    this.colors = col;
    const lm = new Uint32Array(next);
    lm.set(this.layerMask);
    this.layerMask = lm;
    const df = new Uint8Array(next);
    df.set(this.depthFlags);
    this.depthFlags = df;
  }
}

const X_AXIS = new Float32Array([1, 0, 0]);
const Y_AXIS = new Float32Array([0, 1, 0]);
const Z_AXIS = new Float32Array([0, 0, 1]);

const AXIS_RED: Color = { r: 0.9, g: 0.25, b: 0.28, a: 1 };
const AXIS_GREEN: Color = { r: 0.35, g: 0.82, b: 0.3, a: 1 };
const AXIS_BLUE: Color = { r: 0.27, g: 0.55, b: 0.95, a: 1 };

/** Rotate `(x, y, z)` by quaternion `q`. Returns a fresh 3-tuple. */
const rotateVec = (x: number, y: number, z: number, q: Quat): [number, number, number] => {
  const qx = q[0]!;
  const qy = q[1]!;
  const qz = q[2]!;
  const qw = q[3]!;
  // t = 2 * cross(q.xyz, v)
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  // v + qw * t + cross(q.xyz, t)
  return [
    x + qw * tx + (qy * tz - qz * ty),
    y + qw * ty + (qz * tx - qx * tz),
    z + qw * tz + (qx * ty - qy * tx),
  ];
};

/** Build two unit vectors spanning the plane with the given `normal`, written into `u`/`v`. */
const orthonormalBasis = (normal: Vec3, u: Float32Array, v: Float32Array): void => {
  const nx = normal[0]!;
  const ny = normal[1]!;
  const nz = normal[2]!;
  basisFromDirection(nx, ny, nz, u, v);
};

/** Two unit vectors perpendicular to direction `(dx, dy, dz)`, written into `u`/`v`. */
const basisFromDirection = (
  dx: number,
  dy: number,
  dz: number,
  u: Float32Array,
  v: Float32Array,
): void => {
  // Pick the world axis least aligned with the direction to avoid a degenerate cross.
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const az = Math.abs(dz);
  let hx = 0;
  let hy = 0;
  let hz = 0;
  if (ax <= ay && ax <= az) hx = 1;
  else if (ay <= az) hy = 1;
  else hz = 1;
  // u = normalize(cross(helper, dir))
  let ux = hy * dz - hz * dy;
  let uy = hz * dx - hx * dz;
  let uz = hx * dy - hy * dx;
  const ulen = Math.hypot(ux, uy, uz) || 1;
  ux /= ulen;
  uy /= ulen;
  uz /= ulen;
  // v = cross(dir, u)
  const vx = dy * uz - dz * uy;
  const vy = dz * ux - dx * uz;
  const vz = dx * uy - dy * ux;
  u[0] = ux;
  u[1] = uy;
  u[2] = uz;
  v[0] = vx;
  v[1] = vy;
  v[2] = vz;
};
