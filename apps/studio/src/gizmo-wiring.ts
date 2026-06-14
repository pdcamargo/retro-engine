import { ImGui, ImGuiKey } from '@mori2003/jsimgui';
import { type Entity } from '@retro-engine/ecs';
import {
  type App,
  Camera,
  type ComputedCamera,
  EDITOR_GIZMO_MASK,
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
  labelChip,
  packU32,
  TransformGizmo,
  worldToScreen,
} from '@retro-engine/editor-sdk';

import { type ViewportTarget } from './viewport';

/**
 * Studio-local marker binding a transform gizmo of a given {@link GizmoMode} to
 * an entity. The demo attaches one per primitive; a real editor would drive the
 * mode from the active tool + selection instead. Studio-local, so no reflection
 * schema (it never persists to a scene).
 */
export class EditorGizmo {
  constructor(public mode: GizmoMode) {}
}

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

/**
 * Drives the editor transform gizmos for the Scene viewport: one
 * {@link TransformGizmo} per entity carrying an {@link EditorGizmo}, all sharing
 * the editor camera and the engine {@link Gizmos} buffer (on the editor render
 * layer, so the Game view never shows them).
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

  constructor(
    private readonly app: App,
    private readonly view: ViewportTarget,
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

  /** Emit handles + apply drags. Call from a `postUpdate` system, before rendering. */
  tick(): void {
    const input = this.captured;
    if (input === null) return;
    const gizmos = this.app.getResource(Gizmos);
    if (gizmos === undefined) return;
    const editor = this.findEditorCamera();
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

    const seen = new Set<number>();
    for (const [entity, marker, transform] of this.app.world.query([EditorGizmo, Transform]).entries()) {
      seen.add(entity);
      let gizmo = this.perEntity.get(entity);
      if (gizmo === undefined) {
        gizmo = new TransformGizmo(gizmos);
        this.perEntity.set(entity, gizmo);
      }
      gizmo.update({ camera, viewport: input.rect, pointer, mode: marker.mode, space, targets: [transform] });
      // In-place Transform writes bypass change detection; mark the component so
      // the gated propagation recomputes the GlobalTransform this frame.
      if (gizmo.state.phase === 'drag') this.app.world.markChanged(entity, Transform);
    }
    for (const key of this.perEntity.keys()) if (!seen.has(key)) this.perEntity.delete(key);
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

  private findEditorCamera(): { entity: Entity; camera: Camera } | undefined {
    for (const [entity, camera] of this.app.world.query([Camera]).entries()) {
      if (camera.target.kind === 'texture' && camera.target.texture === this.view.texture) {
        return { entity, camera };
      }
    }
    return undefined;
  }
}
