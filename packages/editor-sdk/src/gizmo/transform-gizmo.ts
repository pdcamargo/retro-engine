import {
  type Color,
  type Mat4,
  type Vec3,
  mat4,
  Plane,
  Ray,
  rayClosestPointToRay,
  rayPlaneIntersect,
  screenSpaceScale,
  signedAngleOnPlane,
  vec3,
} from '@retro-engine/math';

import type { Vec2 } from '../units';

import {
  applyRotation,
  applyScale,
  applyTranslation,
  computePivot,
  restoreTargets,
  snapshotTargets,
  type TargetSnapshot,
} from './drag';
import { distance2D, pointRingDistance2D, pointSegmentDistance2D, worldToScreen } from './hit-test';
import type { GizmoConfig, GizmoHandle, GizmoInput, GizmosLike, GizmoState } from './types';

const RED: Color = { r: 0.92, g: 0.27, b: 0.3, a: 1 };
const GREEN: Color = { r: 0.4, g: 0.82, b: 0.34, a: 1 };
const BLUE: Color = { r: 0.3, g: 0.55, b: 0.95, a: 1 };
const HOVER: Color = { r: 1, g: 0.85, b: 0.2, a: 1 };
const NEUTRAL: Color = { r: 0.85, g: 0.87, b: 0.9, a: 1 };
const AXIS_COLORS: readonly Color[] = [RED, GREEN, BLUE];

const ON_TOP = { depthTest: false } as const;

/** Live drag readout the host renders as a 2D overlay (see {@link TransformGizmo.drag}). */
export interface GizmoDragReadout {
  /** The drag's origin pivot, in world space — the dashed line's start. */
  readonly pivot0: Vec3;
  /**
   * The targets' current pivot, in world space — the dashed line's end and the
   * label anchor. This tracks the constrained object motion, not the free
   * cursor, so an axis drag reads along the axis even as the mouse wanders.
   */
  readonly pivotNow: Vec3;
  /** Formatted readout, e.g. `Δ 1.20, 0.00, 0.00` or `37.0°` or `×1.40`. */
  readonly label: string;
}

interface DragSession {
  handle: GizmoHandle;
  pivot0: Vec3;
  snaps: TargetSnapshot[];
  cancelled: boolean;
  axis: Vec3;
  planeNormal: Vec3;
  startScalar: number;
  startHit: Vec3;
  startVec: Vec3;
  startCursor: Vec2;
  // Live readout for the 2D HUD.
  deltaX: number;
  deltaY: number;
  deltaZ: number;
  angle: number;
  factor: number;
}

/**
 * Editor transform gizmo: interactive Move / Rotate / Scale / All handles that
 * mutate one or more {@link GizmoTarget}s about their shared centroid.
 *
 * Drive it once per frame with {@link update}, supplying the camera, viewport
 * rect, pointer/keyboard edges, mode, space, and targets. Handles render as 3D
 * lines through the injected {@link GizmosLike}; the live drag readout draws
 * through the optional {@link Draw}. Handles keep a constant on-screen size at
 * any camera distance, and an in-progress drag reverts on cancel.
 *
 * The host is responsible for routing input only while the relevant viewport is
 * hovered, and for suppressing camera navigation while {@link state} is not
 * `idle`.
 */
export class TransformGizmo {
  private readonly gizmos: GizmosLike;
  private readonly pixelSize: number;
  private readonly hitTolerance: number;
  private readonly arcSegments: number;

  private _state: GizmoState = { phase: 'idle' };
  private _drag: GizmoDragReadout | null = null;
  private session: DragSession | null = null;

  // Scratch reused each frame.
  private readonly pivot = vec3.create(0, 0, 0);
  private readonly invViewProj = mat4.create();
  private readonly viewDir = vec3.create(0, 0, 1);
  private readonly mouseRay = new Ray();
  private readonly axisRay = new Ray();
  private readonly plane = new Plane(vec3.create(0, 0, 1), 0);
  private readonly tmp = vec3.create(0, 0, 0);

  constructor(gizmos: GizmosLike, config: GizmoConfig = {}) {
    this.gizmos = gizmos;
    this.pixelSize = config.pixelSize ?? 90;
    this.hitTolerance = config.hitTolerance ?? 9;
    this.arcSegments = config.arcSegments ?? 48;
  }

  /** Current interaction phase. `idle` ⇒ not hovering or dragging. */
  get state(): GizmoState {
    return this._state;
  }

  /** True while hovering or dragging — the host should suppress camera navigation. */
  get isActive(): boolean {
    return this._state.phase !== 'idle';
  }

  /**
   * The live drag readout while a drag is in progress (and not cancelled),
   * otherwise `null`. The host renders it as a 2D overlay: project
   * {@link GizmoDragReadout.pivot0} to screen, draw a dashed line to the cursor,
   * and label it. Kept separate from {@link update} so the 3D handles can be
   * emitted from a simulation system while the overlay draws in the UI pass.
   */
  get drag(): GizmoDragReadout | null {
    return this._drag;
  }

  /**
   * Process one frame: emit the 3D handles through the injected gizmo buffer,
   * run hit-testing/drag, and mutate the targets. Must run before the frame's
   * render so the emitted handles are drawn this frame. Returns the resulting
   * {@link GizmoState}; read {@link drag} afterwards for the 2D overlay.
   */
  update(input: GizmoInput): GizmoState {
    if (input.targets.length === 0) {
      this.session = null;
      this._state = { phase: 'idle' };
      return this._state;
    }

    const cam = input.camera;
    computePivot(input.targets, this.pivot);
    mat4.inverse(cam.viewProjectionMatrix, this.invViewProj);
    let f = screenSpaceScale(this.pivot, cam.viewProjectionMatrix, cam.targetSize.height, this.pixelSize);
    if (!(f > 0)) f = 1;
    vec3.sub(cam.worldPosition, this.pivot, this.viewDir);
    vec3.normalize(this.viewDir, this.viewDir);

    const cursor = input.pointer.position;
    const haveCursor = cursor !== null;
    if (haveCursor) {
      Ray.fromScreen(
        cursor[0],
        cursor[1],
        input.viewport.x,
        input.viewport.y,
        input.viewport.width,
        input.viewport.height,
        this.invViewProj,
        this.mouseRay,
      );
    }

    const handles = this.handlesFor(input);

    if (this.session !== null) {
      const session = this.session;
      if (input.pointer.cancel && !session.cancelled) {
        restoreTargets(input.targets, session.snaps);
        session.cancelled = true;
      } else if (!session.cancelled && input.pointer.down && haveCursor) {
        this.applyDrag(session, input, cursor!);
      }
      this.renderHandles(handles, f, session.handle, input);
      this._drag = session.cancelled
        ? null
        : { pivot0: session.pivot0, pivotNow: vec3.clone(this.pivot), label: this.dragLabel(session) };
      if (input.pointer.released) {
        this.session = null;
        this._drag = null;
        this._state = { phase: 'idle' };
        return this._state;
      }
      this._state = { phase: 'drag', handle: session.handle, cancelled: session.cancelled };
      return this._state;
    }
    this._drag = null;

    const hovered = haveCursor ? this.pickHandle(handles, cursor!, f, input) : null;
    this.renderHandles(handles, f, hovered, input);

    if (hovered !== null && input.pointer.pressed && haveCursor) {
      this.session = this.beginDrag(hovered, input, cursor!);
      this._state = { phase: 'drag', handle: hovered, cancelled: false };
      return this._state;
    }
    this._state = hovered !== null ? { phase: 'hover', handle: hovered } : { phase: 'idle' };
    return this._state;
  }

  private handlesFor(input: GizmoInput): GizmoHandle[] {
    const { mode, space } = input;
    const out: GizmoHandle[] = [];
    const axes = space === '3d' ? ([0, 1, 2] as const) : ([0, 1] as const);
    const wantMove = mode === 'move' || mode === 'all';
    const wantRot = mode === 'rotate' || mode === 'all';
    const wantScale = mode === 'scale' || mode === 'all';
    if (wantMove) {
      for (const a of axes) out.push({ kind: 'move-axis', axis: a });
      if (space === '3d') {
        for (const a of [0, 1, 2] as const) out.push({ kind: 'move-plane', axis: a });
        out.push({ kind: 'move-screen' });
      } else {
        out.push({ kind: 'move-plane', axis: 2 }); // the XY plane
      }
    }
    if (wantRot) {
      if (space === '3d') {
        for (const a of [0, 1, 2] as const) out.push({ kind: 'rotate-axis', axis: a });
        out.push({ kind: 'rotate-screen' });
      } else {
        out.push({ kind: 'rotate-axis', axis: 2 }); // about Z
      }
    }
    if (wantScale) {
      if (mode === 'scale') {
        for (const a of axes) out.push({ kind: 'scale-axis', axis: a });
      }
      out.push({ kind: 'scale-uniform' });
    }
    return out;
  }

  // --- geometry helpers (world space) ---

  private axisVec(a: 0 | 1 | 2): Vec3 {
    this.tmp[0] = a === 0 ? 1 : 0;
    this.tmp[1] = a === 1 ? 1 : 0;
    this.tmp[2] = a === 2 ? 1 : 0;
    return this.tmp;
  }

  private tip(a: 0 | 1 | 2, f: number, dst: Vec3): Vec3 {
    dst[0] = this.pivot[0]! + (a === 0 ? f : 0);
    dst[1] = this.pivot[1]! + (a === 1 ? f : 0);
    dst[2] = this.pivot[2]! + (a === 2 ? f : 0);
    return dst;
  }

  // --- hit testing ---

  private pickHandle(handles: readonly GizmoHandle[], cursor: Vec2, f: number, input: GizmoInput): GizmoHandle | null {
    const vp = input.viewport;
    const vproj = input.camera.viewProjectionMatrix;
    const pivotScreen = worldToScreen(this.pivot, vproj, vp);
    if (pivotScreen === null) return null;
    const tol = this.hitTolerance;
    let best: GizmoHandle | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    let bestPriority = -1;

    const consider = (handle: GizmoHandle, dist: number, priority: number, slack = 0): void => {
      if (dist > tol + slack) return;
      if (priority > bestPriority || (priority === bestPriority && dist < bestScore)) {
        best = handle;
        bestScore = dist;
        bestPriority = priority;
      }
    };

    const tipScratch = vec3.create(0, 0, 0);
    for (const h of handles) {
      switch (h.kind) {
        case 'move-axis':
        case 'scale-axis': {
          const tipScreen = worldToScreen(this.tip(h.axis, f, tipScratch), vproj, vp);
          if (tipScreen !== null) consider(h, pointSegmentDistance2D(cursor, pivotScreen, tipScreen), 3);
          break;
        }
        case 'move-plane': {
          const center = this.planeHandleCenter(h.axis, f, tipScratch);
          const cs = worldToScreen(center, vproj, vp);
          if (cs !== null) consider(h, distance2D(cursor, cs), 2, tol * 0.8);
          break;
        }
        case 'rotate-axis': {
          const radius = this.ringRadiusScreen(h.axis, f, pivotScreen, vproj, vp);
          if (radius > 0) consider(h, pointRingDistance2D(cursor, pivotScreen, radius), 2);
          break;
        }
        case 'rotate-screen': {
          const radius = this.ringRadiusScreen(0, f * 1.15, pivotScreen, vproj, vp);
          if (radius > 0) consider(h, pointRingDistance2D(cursor, pivotScreen, radius), 1);
          break;
        }
        case 'move-screen':
        case 'scale-uniform':
          consider(h, distance2D(cursor, pivotScreen), 4, tol * 0.6);
          break;
      }
    }
    return best;
  }

  private planeHandleCenter(axis: 0 | 1 | 2, f: number, dst: Vec3): Vec3 {
    // Centered in the quadrant of the two axes orthogonal to `axis`.
    const o = 0.4 * f;
    dst[0] = this.pivot[0]! + (axis === 0 ? 0 : o);
    dst[1] = this.pivot[1]! + (axis === 1 ? 0 : o);
    dst[2] = this.pivot[2]! + (axis === 2 ? 0 : o);
    return dst;
  }

  private ringRadiusScreen(axis: 0 | 1 | 2, f: number, pivotScreen: Vec2, vproj: Mat4, vp: { x: number; y: number; width: number; height: number }): number {
    // Approximate the projected ring radius by the screen distance to a point one
    // radius along an in-plane axis.
    const perp = (axis + 1) % 3;
    const p = vec3.create(
      this.pivot[0]! + (perp === 0 ? f : 0),
      this.pivot[1]! + (perp === 1 ? f : 0),
      this.pivot[2]! + (perp === 2 ? f : 0),
    );
    const s = worldToScreen(p, vproj, vp);
    return s === null ? 0 : distance2D(pivotScreen, s);
  }

  // --- rendering ---

  private renderHandles(handles: readonly GizmoHandle[], f: number, active: GizmoHandle | null, input: GizmoInput): void {
    const g = this.gizmos;
    const tipScratch = vec3.create(0, 0, 0);
    for (const h of handles) {
      const hot = active !== null && sameHandle(h, active);
      switch (h.kind) {
        case 'move-axis': {
          const c = hot ? HOVER : AXIS_COLORS[h.axis]!;
          g.arrow(this.pivot, this.tip(h.axis, f, tipScratch), c, f * 0.18, ON_TOP);
          break;
        }
        case 'scale-axis': {
          const c = hot ? HOVER : AXIS_COLORS[h.axis]!;
          const tip = this.tip(h.axis, f, tipScratch);
          g.line(this.pivot, tip, c, ON_TOP);
          g.cuboid(tip, this.uniform(f * 0.07), c, undefined, ON_TOP);
          break;
        }
        case 'move-plane': {
          this.renderPlaneHandle(h.axis, f, hot, input.space);
          break;
        }
        case 'move-screen':
          g.circle(this.pivot, this.viewDir, f * 0.12, hot ? HOVER : NEUTRAL, 20, ON_TOP);
          break;
        case 'rotate-axis':
          g.circle(this.pivot, this.axisVec(h.axis), f, hot ? HOVER : AXIS_COLORS[h.axis]!, this.arcSegments, ON_TOP);
          break;
        case 'rotate-screen':
          g.circle(this.pivot, this.viewDir, f * 1.15, hot ? HOVER : NEUTRAL, this.arcSegments, ON_TOP);
          break;
        case 'scale-uniform':
          g.cuboid(this.pivot, this.uniform(f * 0.1), hot ? HOVER : NEUTRAL, undefined, ON_TOP);
          break;
      }
    }
  }

  private renderPlaneHandle(axis: 0 | 1 | 2, f: number, hot: boolean, space: GizmoInput['space']): void {
    const u = (axis + 1) % 3;
    const v = (axis + 2) % 3;
    const lo = 0.28 * f;
    const hi = 0.6 * f;
    const corner = (su: number, sv: number, dst: Vec3): Vec3 => {
      dst[0] = this.pivot[0]! + (u === 0 ? su : 0) + (v === 0 ? sv : 0);
      dst[1] = this.pivot[1]! + (u === 1 ? su : 0) + (v === 1 ? sv : 0);
      dst[2] = this.pivot[2]! + (u === 2 ? su : 0) + (v === 2 ? sv : 0);
      return dst;
    };
    const color = hot ? HOVER : space === '2d' ? NEUTRAL : AXIS_COLORS[axis]!;
    const a = vec3.create(0, 0, 0);
    const b = vec3.create(0, 0, 0);
    const c = vec3.create(0, 0, 0);
    const d = vec3.create(0, 0, 0);
    corner(lo, lo, a);
    corner(hi, lo, b);
    corner(hi, hi, c);
    corner(lo, hi, d);
    this.gizmos.line(a, b, color, ON_TOP);
    this.gizmos.line(b, c, color, ON_TOP);
    this.gizmos.line(c, d, color, ON_TOP);
    this.gizmos.line(d, a, color, ON_TOP);
  }

  private uniform(half: number): Vec3 {
    return vec3.create(half, half, half);
  }

  // --- drag lifecycle ---

  private beginDrag(handle: GizmoHandle, input: GizmoInput, cursor: Vec2): DragSession {
    const session: DragSession = {
      handle,
      pivot0: vec3.clone(this.pivot),
      snaps: snapshotTargets(input.targets),
      cancelled: false,
      axis: vec3.create(0, 0, 0),
      planeNormal: vec3.create(0, 0, 1),
      startScalar: 0,
      startHit: vec3.create(0, 0, 0),
      startVec: vec3.create(0, 0, 1),
      startCursor: [cursor[0], cursor[1]],
      deltaX: 0,
      deltaY: 0,
      deltaZ: 0,
      angle: 0,
      factor: 1,
    };
    switch (handle.kind) {
      case 'move-axis':
      case 'scale-axis': {
        vec3.copy(this.axisVec(handle.axis), session.axis);
        this.setAxisRay(session.pivot0, session.axis);
        session.startScalar = rayClosestPointToRay(this.axisRay, this.mouseRay).tA;
        break;
      }
      case 'move-plane': {
        vec3.copy(this.axisVec(handle.axis), session.planeNormal);
        this.intersectPlane(session.pivot0, session.planeNormal, session.startHit);
        break;
      }
      case 'move-screen': {
        vec3.copy(this.viewDir, session.planeNormal);
        this.intersectPlane(session.pivot0, session.planeNormal, session.startHit);
        break;
      }
      case 'rotate-axis':
      case 'rotate-screen': {
        vec3.copy(handle.kind === 'rotate-axis' ? this.axisVec(handle.axis) : this.viewDir, session.planeNormal);
        this.intersectPlane(session.pivot0, session.planeNormal, session.startHit);
        vec3.sub(session.startHit, session.pivot0, session.startVec);
        break;
      }
      case 'scale-uniform':
        break;
    }
    return session;
  }

  private applyDrag(session: DragSession, input: GizmoInput, cursor: Vec2): void {
    const targets = input.targets;
    switch (session.handle.kind) {
      case 'move-axis': {
        this.setAxisRay(session.pivot0, session.axis);
        const tA = rayClosestPointToRay(this.axisRay, this.mouseRay).tA;
        const d = tA - session.startScalar;
        session.deltaX = session.axis[0]! * d;
        session.deltaY = session.axis[1]! * d;
        session.deltaZ = session.axis[2]! * d;
        applyTranslation(targets, session.snaps, session.deltaX, session.deltaY, session.deltaZ);
        break;
      }
      case 'move-plane':
      case 'move-screen': {
        const t = rayPlaneIntersect(this.mouseRay, this.planeFor(session.pivot0, session.planeNormal));
        if (Number.isNaN(t)) break;
        this.mouseRay.at(t, this.tmp);
        session.deltaX = this.tmp[0]! - session.startHit[0]!;
        session.deltaY = this.tmp[1]! - session.startHit[1]!;
        session.deltaZ = this.tmp[2]! - session.startHit[2]!;
        applyTranslation(targets, session.snaps, session.deltaX, session.deltaY, session.deltaZ);
        break;
      }
      case 'rotate-axis':
      case 'rotate-screen': {
        const t = rayPlaneIntersect(this.mouseRay, this.planeFor(session.pivot0, session.planeNormal));
        if (Number.isNaN(t)) break;
        this.mouseRay.at(t, this.tmp);
        vec3.sub(this.tmp, session.pivot0, this.tmp);
        session.angle = signedAngleOnPlane(session.startVec, this.tmp, session.planeNormal);
        applyRotation(targets, session.snaps, session.pivot0, session.planeNormal, session.angle);
        break;
      }
      case 'scale-axis': {
        this.setAxisRay(session.pivot0, session.axis);
        const tA = rayClosestPointToRay(this.axisRay, this.mouseRay).tA;
        const factor = session.startScalar !== 0 ? clampFactor(tA / session.startScalar) : 1;
        session.factor = factor;
        const a = session.handle.axis;
        applyScale(targets, session.snaps, session.pivot0, a === 0 ? factor : 1, a === 1 ? factor : 1, a === 2 ? factor : 1);
        break;
      }
      case 'scale-uniform': {
        const factor = clampFactor(1 + (cursor[0] - session.startCursor[0]) * 0.01);
        session.factor = factor;
        applyScale(targets, session.snaps, session.pivot0, factor, factor, factor);
        break;
      }
    }
  }

  private dragLabel(session: DragSession): string {
    switch (session.handle.kind) {
      case 'rotate-axis':
      case 'rotate-screen':
        return `${((session.angle * 180) / Math.PI).toFixed(1)}°`;
      case 'scale-axis':
      case 'scale-uniform':
        return `×${session.factor.toFixed(2)}`;
      default:
        return `Δ ${session.deltaX.toFixed(2)}, ${session.deltaY.toFixed(2)}, ${session.deltaZ.toFixed(2)}`;
    }
  }

  private setAxisRay(origin: Vec3, dir: Vec3): void {
    this.axisRay.origin[0] = origin[0]!;
    this.axisRay.origin[1] = origin[1]!;
    this.axisRay.origin[2] = origin[2]!;
    this.axisRay.direction[0] = dir[0]!;
    this.axisRay.direction[1] = dir[1]!;
    this.axisRay.direction[2] = dir[2]!;
  }

  private planeFor(point: Vec3, normal: Vec3): Plane {
    this.plane.normal[0] = normal[0]!;
    this.plane.normal[1] = normal[1]!;
    this.plane.normal[2] = normal[2]!;
    this.plane.d = -(normal[0]! * point[0]! + normal[1]! * point[1]! + normal[2]! * point[2]!);
    return this.plane;
  }

  private intersectPlane(point: Vec3, normal: Vec3, dst: Vec3): void {
    const t = rayPlaneIntersect(this.mouseRay, this.planeFor(point, normal));
    if (Number.isNaN(t)) {
      vec3.copy(point, dst);
      return;
    }
    this.mouseRay.at(t, dst);
  }
}

const clampFactor = (f: number): number => (f < 0.01 ? 0.01 : f);

const sameHandle = (a: GizmoHandle, b: GizmoHandle): boolean =>
  a.kind === b.kind && (a as { axis?: number }).axis === (b as { axis?: number }).axis;
