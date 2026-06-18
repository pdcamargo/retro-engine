import { ImGui, ImGuiKey } from '@mori2003/jsimgui';
import {
  type App,
  type ComputedCamera,
  composeTransformInto,
  decomposeTransformInto,
  EDITOR_GIZMO_MASK,
  GlobalTransform,
  Gizmos,
  OrthographicProjection,
  Transform,
} from '@retro-engine/engine';
import {
  dashedLine,
  Draw,
  type GizmoInput,
  type GizmoMode,
  type GizmoSpace,
  type GizmoTarget,
  labelChip,
  packU32,
  TransformGizmo,
  worldToScreen,
} from '@retro-engine/editor-sdk';
import { mat4, quat, vec3 } from '@retro-engine/math';

import { findEditorCamera } from './editor-view';
import { type StudioState, type TransformTool } from './state';
import { type ViewportTarget } from './viewport';

interface ViewportRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface CapturedInput {
  rect: ViewportRect;
  hovered: boolean;
  mouse: [number, number];
  down: boolean;
  pressed: boolean;
  released: boolean;
  cancel: boolean;
}

const DASH_COLOR = packU32(0xf2, 0xc8, 0x4b, 230);

/** The transform tool drives the gizmo mode; `select` shows no gizmo at all. */
const modeForTool = (tool: TransformTool): GizmoMode | null =>
  tool === 'select' ? null : (tool satisfies GizmoMode);

/**
 * Drives the editor transform gizmo for the Scene viewport. The gizmo binds to
 * the current selection ({@link StudioState.selectedEntity}) and reads its mode
 * from the active transform tool ({@link StudioState.tool}): one
 * {@link TransformGizmo} on the editor camera + the engine {@link Gizmos} buffer
 * (on the editor render layer, so the Game view never shows the handles).
 *
 * The work is split across the frame because the 3D handles must be emitted
 * before the render graph runs while ImGui input + draw lists are only available
 * in the UI pass:
 *
 * - {@link capture} runs in the Scene panel body (UI pass): records the viewport
 *   rect, hover state, and pointer/keyboard edges.
 * - {@link tick} runs in `postUpdate` (before rendering): emits the 3D handles
 *   and applies drags, using the input captured the previous frame.
 * - {@link drawOverlay} runs in the Scene panel body: draws the 2D drag readout.
 */
export class SceneGizmos {
  private readonly perEntity = new Map<number, TransformGizmo>();
  private captured: CapturedInput | null = null;
  private hudViewProj: Float32Array | null = null;
  private hudRect: ViewportRect | null = null;

  // World-space proxy the gizmo edits: the selection's GlobalTransform decomposed
  // into TRS each frame. Edits map back to the entity's local Transform through
  // the parent's inverse (see `tick`). Scratch matrices for that conversion.
  private readonly proxy: GizmoTarget = {
    translation: vec3.create(0, 0, 0),
    rotation: quat.identity(),
    scale: vec3.create(1, 1, 1),
  };
  private readonly localM = mat4.identity();
  private readonly worldInv = mat4.identity();
  private readonly parentInv = mat4.identity();
  private readonly newWorldM = mat4.identity();
  private readonly newLocalM = mat4.identity();

  constructor(
    private readonly app: App,
    private readonly view: ViewportTarget,
    private readonly state: StudioState,
  ) {}

  /** Record this frame's viewport rect + ImGui pointer state. Call from the Scene panel body. */
  capture(rect: ViewportRect, hovered: boolean): void {
    const m = ImGui.GetMousePos();
    this.captured = {
      rect,
      hovered,
      mouse: [m.x, m.y],
      down: ImGui.IsMouseDown(0),
      pressed: ImGui.IsMouseClicked(0, false),
      released: ImGui.IsMouseReleased(0),
      cancel: ImGui.IsKeyPressed(ImGuiKey._Escape, false),
    };
  }

  /**
   * Whether the gizmo is currently engaged — hovering a handle or mid-drag. The
   * scene picker reads this to enforce the transform lock: a click that lands on
   * a handle (or any click during a drag) must not re-pick another entity.
   */
  isActive(): boolean {
    for (const gizmo of this.perEntity.values()) {
      if (gizmo.state.phase !== 'idle') return true;
    }
    return false;
  }

  /** Emit handles + apply drags. Call from a `postUpdate` system, before rendering. */
  tick(): void {
    const input = this.captured;
    if (input === null) return;
    const gizmos = this.app.getResource(Gizmos);
    if (gizmos === undefined) return;
    const editor = findEditorCamera(this.app, this.view);
    if (editor === undefined) return;
    const computed: ComputedCamera = editor.camera.computed;

    gizmos.defaultLayerMask = EDITOR_GIZMO_MASK;
    this.hudViewProj = computed.viewProjectionMatrix as Float32Array;
    this.hudRect = input.rect;

    const space: GizmoSpace =
      this.app.world.getComponent(editor.entity, OrthographicProjection) !== undefined ? '2d' : '3d';

    const anyDragging = [...this.perEntity.values()].some((g) => g.state.phase === 'drag');
    const wantInput = input.hovered || anyDragging;
    const pointer: GizmoInput['pointer'] = {
      position: wantInput ? input.mouse : null,
      down: input.down,
      pressed: wantInput && input.pressed,
      released: input.released,
      cancel: input.cancel,
    };
    // Edges are one-shot — consume them so a frame without a fresh capture can't replay.
    input.pressed = false;
    input.released = false;
    input.cancel = false;

    const camera = {
      viewProjectionMatrix: computed.viewProjectionMatrix,
      worldPosition: computed.worldPosition,
      targetSize: computed.targetSize,
    };

    // The gizmo binds to the selection, in the active tool's mode, when gizmos
    // are enabled. `select` (or no selection / no Transform) leaves nothing to
    // drive — drop any per-entity state so a stale drag can't linger.
    const selected = this.state.selectedEntity;
    const mode = this.state.gizmos ? modeForTool(this.state.tool) : null;
    const transform =
      selected !== null && mode !== null ? this.app.world.getComponent(selected, Transform) : undefined;
    const global =
      selected !== null && mode !== null ? this.app.world.getComponent(selected, GlobalTransform) : undefined;

    if (selected === null || mode === null || transform === undefined || global === undefined) {
      this.perEntity.clear();
      return;
    }

    // Reuse the selected entity's gizmo so an in-progress drag survives across
    // frames; drop every other entry so a stale drag from a prior selection
    // can't linger.
    const gizmo = this.perEntity.get(selected) ?? new TransformGizmo(gizmos);
    this.perEntity.clear();
    this.perEntity.set(selected, gizmo);

    // The gizmo operates in world space, so it edits a proxy decomposed from the
    // entity's GlobalTransform — handles sit at the world pose and drags happen
    // along world axes. Editing the local Transform directly would misplace the
    // gizmo for any entity under a transformed parent.
    decomposeTransformInto(this.proxy.translation, this.proxy.rotation, this.proxy.scale, global.matrix);
    gizmo.update({ camera, viewport: input.rect, pointer, mode, space, targets: [this.proxy] });

    if (gizmo.state.phase === 'drag') {
      // Map the edited world pose back to the entity's local Transform:
      //   local_new = P⁻¹ · world_new,  where  P⁻¹ = local_old · world_old⁻¹.
      // Deriving P⁻¹ from the matrices already in hand avoids a Parent lookup and
      // holds at any nesting depth (P is the parent's world transform, constant
      // through the drag).
      composeTransformInto(this.localM, transform.translation, transform.rotation, transform.scale);
      mat4.inverse(global.matrix, this.worldInv);
      mat4.multiply(this.localM, this.worldInv, this.parentInv);
      composeTransformInto(this.newWorldM, this.proxy.translation, this.proxy.rotation, this.proxy.scale);
      mat4.multiply(this.parentInv, this.newWorldM, this.newLocalM);
      decomposeTransformInto(transform.translation, transform.rotation, transform.scale, this.newLocalM);
      // In-place Transform writes bypass change detection; mark the component so
      // the gated propagation recomputes the GlobalTransform this frame.
      this.app.world.markChanged(selected, Transform);
    }
  }

  /** Draw the 2D drag readout over the viewport. Call from the Scene panel body. */
  drawOverlay(): void {
    if (this.hudViewProj === null || this.hudRect === null) return;
    const draw = Draw.window();
    for (const gizmo of this.perEntity.values()) {
      const drag = gizmo.drag;
      if (drag === null) continue;
      // Anchor the readout to the object's constrained motion, not the cursor:
      // the dashed line runs from where the drag started to where the object is
      // now, and the label sits on the object.
      const startScreen = worldToScreen(drag.pivot0, this.hudViewProj, this.hudRect);
      const nowScreen = worldToScreen(drag.pivotNow, this.hudViewProj, this.hudRect);
      if (nowScreen === null) continue;
      if (startScreen !== null) dashedLine(draw, startScreen, nowScreen, DASH_COLOR);
      labelChip(draw, nowScreen, drag.label);
    }
  }
}
