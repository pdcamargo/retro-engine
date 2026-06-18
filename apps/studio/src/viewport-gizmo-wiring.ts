import { ImGui } from '@mori2003/jsimgui';
import { type App } from '@retro-engine/engine';
import { ViewportGizmo } from '@retro-engine/editor-sdk';

import { type SceneCameraController } from './editor-camera';
import { findEditorCamera } from './editor-view';
import { type StudioState } from './state';
import { type ViewportTarget } from './viewport';

interface ViewportRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Drives the Scene viewport's orientation gizmo — the corner widget that mirrors
 * the editor camera's orientation and lets the user drag to orbit or click an
 * axis to align the view.
 *
 * Entirely a UI-pass concern: {@link drawAndCapture} reads the editor camera's
 * view matrix and ImGui pointer state, lets the {@link ViewportGizmo} draw +
 * resolve intents, then forwards those to the {@link SceneCameraController}
 * (which applies them from its own `update` tick, the single writer of the
 * camera transform). It owns no per-frame system.
 */
export class SceneOrientationGizmo {
  private readonly gizmo: ViewportGizmo;

  constructor(
    private readonly app: App,
    private readonly view: ViewportTarget,
    private readonly state: StudioState,
    private readonly camera: SceneCameraController,
  ) {
    // Hold the live options object so Settings edits restyle the gizmo in place.
    this.gizmo = new ViewportGizmo(this.state.viewportGizmo);
  }

  /**
   * Draw the gizmo and apply its intents for this frame. Returns whether the
   * gizmo captured the pointer, so the Scene panel can suppress camera
   * navigation and entity picking while the user is on the widget.
   */
  drawAndCapture(rect: ViewportRect, hovered: boolean): boolean {
    const editor = findEditorCamera(this.app, this.view);
    if (editor === undefined) return false;

    const m = ImGui.GetMousePos();
    const out = this.gizmo.update({
      viewport: rect,
      viewMatrix: editor.camera.computed.viewMatrix,
      hovered,
      pointer: {
        position: [m.x, m.y],
        down: ImGui.IsMouseDown(0),
        pressed: ImGui.IsMouseClicked(0, false),
        released: ImGui.IsMouseReleased(0),
      },
    });

    if (out.orbit !== null) {
      this.promoteFrom2d();
      this.camera.requestOrbit(out.orbit.dYaw, out.orbit.dPitch);
    }
    if (out.pick !== null) {
      this.promoteFrom2d();
      this.camera.snapToAxis(out.pick, {
        animated: this.state.viewportGizmo.animated,
        speed: this.state.viewportGizmo.speed,
      });
    }
    return out.active;
  }

  /** Leave the 2D orthographic view for 3D when the gizmo is used, if enabled. */
  private promoteFrom2d(): void {
    if (this.state.viewMode === '2d' && this.state.viewportGizmo.exit2dOnInteract) {
      this.state.viewMode = '3d';
    }
  }
}
