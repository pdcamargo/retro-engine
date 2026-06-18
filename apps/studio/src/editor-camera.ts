import { ImGui, ImGuiKey } from '@mori2003/jsimgui';
import { type Entity } from '@retro-engine/ecs';
import {
  type App,
  Camera,
  Camera3d,
  CameraRenderTarget,
  ClearColorConfig,
  type CommandsHandle,
  DepthPrepass,
  EDITOR_GIZMO_LAYER,
  MotionVectorPrepass,
  OrthographicProjection,
  PerspectiveProjection,
  RenderLayers,
  ScalingMode,
  Taa,
  Time,
  Transform,
} from '@retro-engine/engine';
import { type AxisPick } from '@retro-engine/editor-sdk';
import { mat4, quat, type Vec3, vec3 } from '@retro-engine/math';
import { type Texture } from '@retro-engine/renderer-core';

import { EditorOnly } from './editor-markers';
import { type ViewportTarget } from './viewport';

/** The editor viewport's projection mode. Persisted in `StudioState.viewMode`. */
export type ViewMode = '2d' | '3d';

/**
 * Marks the studio's own editor camera. The viewport, gizmo wiring, and
 * resize-redirect all find this camera by its render-target texture, so the
 * tag exists only so the mode toggle can despawn the current editor camera
 * before respawning it in the other projection. Studio-local — never persisted,
 * so no reflection schema.
 */
export class EditorCameraTag {}

/** Default 3D framing: where the perspective editor camera sits and looks. */
const DEFAULT_EYE: readonly [number, number, number] = [8, 6.5, 10];
const DEFAULT_TARGET: readonly [number, number, number] = [0, 0.3, 0];
/** World units visible vertically when the 2D editor camera first opens. */
const DEFAULT_VIEW_HEIGHT = 16;

const FLY_SPEED = 6; // world units / second
const FLY_FAST_MULT = 4;
const LOOK_SENS = 0.005; // radians / pixel
const ORBIT_SENS = 0.01; // radians / pixel
const DOLLY_STEP = 0.12; // fraction of pivot distance per wheel notch
const ZOOM_RATE = 0.12; // 2D zoom per wheel notch
const MAX_PITCH = (89 * Math.PI) / 180;
const TURN_RATE = 2 * Math.PI; // radians/second base speed for the orientation-gizmo snap
const SNAP_EPSILON = 1e-3; // angular tolerance (rad) at which a snap animation completes

/** A pending axis-align request from the orientation gizmo. */
interface SnapRequest {
  yaw: number;
  pitch: number;
  radius: number;
  animated: boolean;
  speed: number;
}

/** Orientation+position that frames `target` from `eye` (looks down −Z). */
export const lookFrom = (eye: Vec3, target: Vec3): Transform => {
  const view = mat4.lookAt(eye, target, vec3.create(0, 1, 0));
  const rotation = quat.fromMat(mat4.inverse(view), quat.create());
  return new Transform(eye, rotation);
};

/**
 * Spawn the editor camera, rendering into `texture` on the editor gizmo layer
 * with the depth/motion prepasses + TAA (the anti-aliased path). It is always a
 * `Core3d` camera so it renders the 3D scene in both viewing modes; the view
 * toggle swaps only its projection (perspective ↔ orthographic), it never
 * respawns the camera.
 */
export const spawnEditorCamera = (cmd: CommandsHandle, texture: Texture, transform: Transform): void => {
  cmd.spawn(
    ...Camera3d({
      hdr: true,
      order: 0,
      target: CameraRenderTarget.texture(texture),
      clearColor: ClearColorConfig.custom({ r: 0.1, g: 0.11, b: 0.13, a: 1 }),
      transform,
    }),
    new DepthPrepass(),
    new MotionVectorPrepass(),
    new Taa(),
    new EditorCameraTag(),
    new EditorOnly(),
    RenderLayers.layers(0, EDITOR_GIZMO_LAYER),
  );
};

/** Near/far for the orthographic 2D view — spans both sides of the work plane like `Camera2d`. */
const ORTHO_NEAR = -1000;
const ORTHO_FAR = 1000;

/** Build the orthographic projection for the 2D view at the current zoom. */
const makeOrtho = (viewHeight: number): OrthographicProjection =>
  new OrthographicProjection({
    near: ORTHO_NEAR,
    far: ORTHO_FAR,
    scalingMode: ScalingMode.fixedVertical(viewHeight),
  });

/** The default perspective framing the editor camera bootstraps with. */
export const defaultEditorTransform = (): Transform =>
  lookFrom(vec3.create(...DEFAULT_EYE), vec3.create(...DEFAULT_TARGET));

/** Per-frame viewport input the controller reads in the UI pass and applies in `update`. */
interface NavInput {
  hovered: boolean;
  viewportHeightPx: number;
  dt: number;
  lookDelta: [number, number];
  panDelta: [number, number];
  orbitDelta: [number, number];
  wheel: number;
  fly: { forward: number; right: number; up: number };
  fast: boolean;
}

type Gesture = 'none' | 'look' | 'pan' | 'orbit';

/**
 * Drives the studio's editor camera from viewport input — the navigation
 * foundation the Scene viewport previously lacked.
 *
 * Work is split across the frame like {@link SceneGizmos}: {@link capture}
 * reads ImGui pointer/wheel/keyboard state in the Scene panel body (the only
 * place ImGui input is live), and {@link tick} applies it to the camera's
 * `Transform` from an `update` system, before the camera plugin recomputes its
 * matrices. Navigation only acts while the viewport is hovered.
 *
 * - **3D:** right-mouse looks (with WASD/QE fly, Shift = faster), middle-mouse
 *   pans, the wheel dollies, and Alt+left-mouse orbits the focus point.
 * - **2D:** middle-mouse or Space+left-mouse pans, the wheel zooms the
 *   orthographic extent; no rotation.
 *
 * {@link setMode} despawns and respawns the camera in the other projection,
 * preserving the per-mode navigation state held here so toggling back and
 * forth is lossless.
 */
export class SceneCameraController {
  /** The projection currently applied to the live camera entity. */
  appliedMode: ViewMode = '3d';

  // 3D navigation state.
  private eye: [number, number, number] = [...DEFAULT_EYE];
  private pivot: [number, number, number] = [...DEFAULT_TARGET];
  private yaw = 0;
  private pitch = 0;

  // 2D navigation state.
  private center: [number, number] = [0, 0];
  private viewHeight = DEFAULT_VIEW_HEIGHT;

  private captured: NavInput | null = null;
  private gesture: Gesture = 'none';
  private lastMouse: [number, number] = [0, 0];

  // Orientation-gizmo requests, applied in `tick` so the controller stays the
  // single writer of the camera transform.
  private pendingOrbit: [number, number] = [0, 0];
  private snap: SnapRequest | null = null;

  constructor(
    private readonly app: App,
    private readonly view: ViewportTarget,
  ) {
    this.deriveAnglesFromEye();
  }

  /** Read this frame's viewport input. Call from the Scene panel body (UI pass). */
  capture(viewportHeightPx: number, hovered: boolean): void {
    const m = ImGui.GetMousePos();
    const mouse: [number, number] = [m.x, m.y];
    const raw: [number, number] = [mouse[0] - this.lastMouse[0], mouse[1] - this.lastMouse[1]];
    this.lastMouse = mouse;

    const io = ImGui.GetIO();
    const left = ImGui.IsMouseDown(0);
    const right = ImGui.IsMouseDown(1);
    const middle = ImGui.IsMouseDown(2);
    const alt = io.KeyAlt;
    const space = ImGui.IsKeyDown(ImGuiKey._Space);

    // Pick (or continue) a drag gesture. A gesture may only start while hovered,
    // but continues until its button releases even if the cursor leaves.
    const wantLook = right;
    const wantPan = middle || (space && left);
    const wantOrbit = alt && left;
    if (this.gesture === 'none') {
      if (hovered && wantLook) this.gesture = 'look';
      else if (hovered && wantOrbit) this.gesture = 'orbit';
      else if (hovered && wantPan) this.gesture = 'pan';
    } else if (
      (this.gesture === 'look' && !wantLook) ||
      (this.gesture === 'orbit' && !wantOrbit) ||
      (this.gesture === 'pan' && !wantPan)
    ) {
      this.gesture = 'none';
    }

    const flyActive = this.gesture === 'look';
    this.captured = {
      hovered,
      viewportHeightPx: Math.max(1, viewportHeightPx),
      dt: io.DeltaTime > 0 ? io.DeltaTime : 1 / 60,
      lookDelta: this.gesture === 'look' ? raw : [0, 0],
      panDelta: this.gesture === 'pan' ? raw : [0, 0],
      orbitDelta: this.gesture === 'orbit' ? raw : [0, 0],
      wheel: hovered ? io.MouseWheel : 0,
      fly: {
        forward: flyActive ? axis(ImGuiKey._W, ImGuiKey._S) : 0,
        right: flyActive ? axis(ImGuiKey._D, ImGuiKey._A) : 0,
        up: flyActive ? axis(ImGuiKey._E, ImGuiKey._Q) : 0,
      },
      fast: io.KeyShift,
    };
  }

  /** Whether a viewport drag gesture (look/pan/orbit) is currently active. */
  get navigating(): boolean {
    return this.gesture !== 'none';
  }

  /** Re-frame the focus point. Bound to the Frame Selected shortcut. */
  frame(): void {
    // No ECS-backed selection yet, so frame the scene origin. When hierarchy
    // selection is wired to live entities this targets the selection's bounds.
    if (this.appliedMode === '3d') {
      this.pivot = [0, 0, 0];
      const dist = 14;
      const f = this.forward();
      this.eye = [
        this.pivot[0] - f[0] * dist,
        this.pivot[1] - f[1] * dist,
        this.pivot[2] - f[2] * dist,
      ];
    } else {
      this.center = [0, 0];
      this.viewHeight = DEFAULT_VIEW_HEIGHT;
    }
  }

  /**
   * Orbit the 3D view by the given yaw/pitch deltas (radians) — the orientation
   * gizmo's drag gesture. Queued and applied in {@link tick}. No-op in 2D (the
   * gizmo wiring promotes the view to 3D first when configured to).
   */
  requestOrbit(dYaw: number, dPitch: number): void {
    this.pendingOrbit[0] += dYaw;
    this.pendingOrbit[1] += dPitch;
  }

  /**
   * Align the 3D view to look down a world axis — the orientation gizmo's
   * click. Looks at the current focus point from the axis side, keeping the
   * current orbit distance. When `animated`, {@link tick} eases the rotation in
   * over a few frames; otherwise it applies immediately.
   */
  snapToAxis(pick: AxisPick, opts: { animated: boolean; speed: number }): void {
    const axis = pick.axis === 'x' ? [1, 0, 0] : pick.axis === 'y' ? [0, 1, 0] : [0, 0, 1];
    // Look from the axis side toward the pivot: forward points along −axis·sign.
    const f: [number, number, number] = [-pick.sign * axis[0]!, -pick.sign * axis[1]!, -pick.sign * axis[2]!];
    const pitch = clamp(Math.asin(clamp(f[1], -1, 1)), -MAX_PITCH, MAX_PITCH);
    // Top/bottom views leave heading undefined — keep the current yaw.
    const yaw = Math.abs(f[1]) > 0.9999 ? this.yaw : Math.atan2(f[0], -f[2]);
    this.snap = { yaw, pitch, radius: dist(this.eye, this.pivot), animated: opts.animated, speed: Math.max(0.01, opts.speed) };
  }

  /** Apply captured input and write the camera transform. Call from an `update` system. */
  tick(): void {
    const cam = this.findEditorCamera();
    if (cam === undefined) return;
    const input = this.captured;
    this.captured = null;
    if (input !== null) {
      if (this.appliedMode === '3d') this.applyInput3d(cam, input);
      else this.applyInput2d(input);
      // Any manual navigation cancels an in-progress axis-align.
      if (this.navigating || input.wheel !== 0) this.snap = null;
    }
    if (this.appliedMode === '3d') {
      this.applyPendingOrbit();
      this.advanceSnap();
      this.writeTransform3d(cam.entity);
    } else {
      // The gizmo only drives the 3D view; drop any stale requests.
      this.pendingOrbit[0] = this.pendingOrbit[1] = 0;
      this.snap = null;
      this.writeTransform2d(cam.entity);
    }
  }

  /** Apply (and clear) the orientation gizmo's queued orbit deltas. */
  private applyPendingOrbit(): void {
    const [dYaw, dPitch] = this.pendingOrbit;
    this.pendingOrbit[0] = this.pendingOrbit[1] = 0;
    if (dYaw === 0 && dPitch === 0) return;
    this.snap = null; // dragging overrides a click-to-align
    this.yaw += dYaw;
    this.pitch = clamp(this.pitch - dPitch, -MAX_PITCH, MAX_PITCH);
    this.placeEyeFromAngles(dist(this.eye, this.pivot));
  }

  /** Step the active axis-align toward its target, easing when animated. */
  private advanceSnap(): void {
    const snap = this.snap;
    if (snap === null) return;
    if (!snap.animated) {
      this.yaw = snap.yaw;
      this.pitch = snap.pitch;
      this.placeEyeFromAngles(snap.radius);
      this.snap = null;
      return;
    }
    const dt = this.app.getResource(Time)?.real.delta ?? 1 / 60;
    const step = dt * TURN_RATE * snap.speed;
    const dYaw = wrapPi(snap.yaw - this.yaw);
    const dPitch = snap.pitch - this.pitch;
    if (Math.abs(dYaw) <= step && Math.abs(dPitch) <= step) {
      this.yaw = snap.yaw;
      this.pitch = snap.pitch;
      this.snap = null;
    } else {
      this.yaw += clamp(dYaw, -step, step);
      this.pitch += clamp(dPitch, -step, step);
      if (Math.abs(dYaw) < SNAP_EPSILON && Math.abs(dPitch) < SNAP_EPSILON) this.snap = null;
    }
    this.placeEyeFromAngles(snap.radius);
  }

  /** Reposition the eye to look at the pivot from `radius` away, per yaw/pitch. */
  private placeEyeFromAngles(radius: number): void {
    const f = this.forward();
    this.eye = [this.pivot[0] - f[0] * radius, this.pivot[1] - f[1] * radius, this.pivot[2] - f[2] * radius];
  }

  /**
   * Switch the editor camera between perspective (3D) and orthographic (2D) by
   * swapping its projection component in place — the camera entity, its Core3d
   * sub-graph, depth, and prepasses are untouched, so the 3D scene keeps
   * rendering in both modes. Call from a system holding a {@link CommandsHandle}.
   */
  setMode(cmd: CommandsHandle, mode: ViewMode): void {
    const cam = this.findEditorCamera();
    if (cam !== undefined) {
      if (mode === '2d') {
        cmd.entity(cam.entity).remove(PerspectiveProjection).insert(makeOrtho(this.viewHeight));
      } else {
        cmd.entity(cam.entity).remove(OrthographicProjection).insert(new PerspectiveProjection());
      }
    }
    this.appliedMode = mode;
  }

  private applyInput3d(cam: { projection: PerspectiveProjection | undefined }, input: NavInput): void {
    // Look: rotate the view in place.
    if (input.lookDelta[0] !== 0 || input.lookDelta[1] !== 0) {
      this.yaw += input.lookDelta[0] * LOOK_SENS;
      this.pitch = clamp(this.pitch - input.lookDelta[1] * LOOK_SENS, -MAX_PITCH, MAX_PITCH);
    }
    // Orbit: swing the eye around the pivot, keeping the focus centered.
    if (input.orbitDelta[0] !== 0 || input.orbitDelta[1] !== 0) {
      this.yaw += input.orbitDelta[0] * ORBIT_SENS;
      this.pitch = clamp(this.pitch - input.orbitDelta[1] * ORBIT_SENS, -MAX_PITCH, MAX_PITCH);
      const radius = dist(this.eye, this.pivot);
      const f = this.forward();
      this.eye = [
        this.pivot[0] - f[0] * radius,
        this.pivot[1] - f[1] * radius,
        this.pivot[2] - f[2] * radius,
      ];
    }
    // Fly: move the eye (and pivot) along the camera basis.
    const speed = FLY_SPEED * (input.fast ? FLY_FAST_MULT : 1) * input.dt;
    if (input.fly.forward !== 0 || input.fly.right !== 0 || input.fly.up !== 0) {
      const f = this.forward();
      const r = this.right();
      const move: [number, number, number] = [
        (f[0] * input.fly.forward + r[0] * input.fly.right) * speed,
        (f[1] * input.fly.forward + r[1] * input.fly.right + input.fly.up) * speed,
        (f[2] * input.fly.forward + r[2] * input.fly.right) * speed,
      ];
      this.translateView(move);
    }
    // Pan: slide eye + pivot in the view plane by a depth-scaled pixel rate.
    if (input.panDelta[0] !== 0 || input.panDelta[1] !== 0) {
      const fov = cam.projection?.fov ?? Math.PI / 4;
      const wpp = (2 * dist(this.eye, this.pivot) * Math.tan(fov / 2)) / input.viewportHeightPx;
      const r = this.right();
      const u = this.up();
      this.translateView([
        (-r[0] * input.panDelta[0] + u[0] * input.panDelta[1]) * wpp,
        (-r[1] * input.panDelta[0] + u[1] * input.panDelta[1]) * wpp,
        (-r[2] * input.panDelta[0] + u[2] * input.panDelta[1]) * wpp,
      ]);
    }
    // Dolly: move the eye toward/along the view direction.
    if (input.wheel !== 0) {
      const step = dist(this.eye, this.pivot) * DOLLY_STEP * input.wheel;
      const f = this.forward();
      this.eye = [this.eye[0] + f[0] * step, this.eye[1] + f[1] * step, this.eye[2] + f[2] * step];
    }
  }

  private applyInput2d(input: NavInput): void {
    if (input.panDelta[0] !== 0 || input.panDelta[1] !== 0) {
      const wpp = this.viewHeight / input.viewportHeightPx;
      this.center[0] -= input.panDelta[0] * wpp;
      this.center[1] += input.panDelta[1] * wpp; // screen-y down → world-y up
    }
    if (input.wheel !== 0) {
      this.viewHeight = clamp(this.viewHeight * Math.exp(-input.wheel * ZOOM_RATE), 0.1, 100_000);
    }
  }

  private writeTransform3d(entity: Entity): void {
    const t = this.app.world.getComponent(entity, Transform);
    if (t === undefined) return;
    const target: [number, number, number] = [
      this.eye[0] + this.forward()[0],
      this.eye[1] + this.forward()[1],
      this.eye[2] + this.forward()[2],
    ];
    const tf = lookFrom(vec3.create(...this.eye), vec3.create(...target));
    t.translation.set(tf.translation);
    t.rotation.set(tf.rotation);
    this.app.world.markChanged(entity, Transform);
  }

  private writeTransform2d(entity: Entity): void {
    const t = this.app.world.getComponent(entity, Transform);
    if (t === undefined) return;
    t.translation.set([this.center[0], this.center[1], 0]);
    t.rotation.set([0, 0, 0, 1]);
    this.app.world.markChanged(entity, Transform);
    const proj = this.app.world.getComponent(entity, OrthographicProjection);
    if (proj !== undefined) proj.scalingMode = ScalingMode.fixedVertical(this.viewHeight);
  }

  private findEditorCamera(): { entity: Entity; projection: PerspectiveProjection | undefined } | undefined {
    for (const [entity, camera] of this.app.world.query([Camera]).entries()) {
      const cam = camera as Camera;
      if (cam.target.kind === 'texture' && cam.target.texture === this.view.texture) {
        return {
          entity,
          projection: this.app.world.getComponent(entity, PerspectiveProjection),
        };
      }
    }
    return undefined;
  }

  /** Forward (view) direction from yaw/pitch; yaw 0 + pitch 0 looks down −Z. */
  private forward(): [number, number, number] {
    const cp = Math.cos(this.pitch);
    return [Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp];
  }

  /** Camera right vector (horizontal, on the XZ plane). */
  private right(): [number, number, number] {
    return [Math.cos(this.yaw), 0, Math.sin(this.yaw)];
  }

  /** Camera up vector (right × forward). */
  private up(): [number, number, number] {
    const f = this.forward();
    const r = this.right();
    return [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  }

  private translateView(delta: [number, number, number]): void {
    this.eye = [this.eye[0] + delta[0], this.eye[1] + delta[1], this.eye[2] + delta[2]];
    this.pivot = [this.pivot[0] + delta[0], this.pivot[1] + delta[1], this.pivot[2] + delta[2]];
  }

  private deriveAnglesFromEye(): void {
    const dir = norm([
      this.pivot[0] - this.eye[0],
      this.pivot[1] - this.eye[1],
      this.pivot[2] - this.eye[2],
    ]);
    this.pitch = Math.asin(clamp(dir[1], -1, 1));
    this.yaw = Math.atan2(dir[0], -dir[2]);
  }
}

/** −1 when the `neg` key is down, +1 when `pos` is down, 0 otherwise/both. */
const axis = (pos: ImGuiKey, neg: ImGuiKey): number =>
  (ImGui.IsKeyDown(pos) ? 1 : 0) - (ImGui.IsKeyDown(neg) ? 1 : 0);

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Wrap an angle to `(−π, π]` so a snap eases along the shortest path. */
const wrapPi = (a: number): number => {
  const t = ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
  return t - Math.PI;
};

type Vec3Tuple = readonly [number, number, number];

const dist = (a: Vec3Tuple, b: Vec3Tuple): number =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const norm = (v: [number, number, number]): [number, number, number] => {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
};
