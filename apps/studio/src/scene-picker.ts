import { ImGui, ImGuiKey } from '@mori2003/jsimgui';
import { type Entity } from '@retro-engine/ecs';
import { type App, type ComputedCamera, GlobalTransform, Mesh3d, Meshes } from '@retro-engine/engine';
import { Aabb, mat4, Ray, rayAabbIntersect } from '@retro-engine/math';

import { findEditorCamera } from './editor-view';
import { type StudioState } from './state';
import { type ViewportTarget } from './viewport';

interface ViewportRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface CapturedClick {
  rect: ViewportRect;
  hovered: boolean;
  mouse: [number, number];
  /** A fresh left-click this frame that isn't part of a camera gesture. */
  pick: boolean;
}

/**
 * Click-to-select for the Scene viewport: casts a ray from the editor camera
 * through the cursor and selects the nearest entity whose mesh bounds it hits,
 * writing {@link StudioState.selectedEntity}. Picking is at AABB granularity —
 * the world-space bounds of each `Mesh3d`, not per-triangle.
 *
 * Like {@link SceneGizmos}, the work is split: {@link capture} records the click
 * in the Scene panel body (UI pass), {@link pick} runs in a `postUpdate` system
 * after the gizmo tick so it can honour the transform lock. A click on empty
 * space clears the selection.
 */
export class ScenePicker {
  private captured: CapturedClick | null = null;
  private readonly ray = new Ray();
  private readonly invViewProj = mat4.identity();
  private readonly worldAabb = new Aabb();

  constructor(
    private readonly app: App,
    private readonly view: ViewportTarget,
    private readonly state: StudioState,
  ) {}

  /** Record this frame's click edge + viewport rect. Call from the Scene panel body. */
  capture(rect: ViewportRect, hovered: boolean): void {
    const m = ImGui.GetMousePos();
    // Skip clicks that drive camera navigation: Alt+LMB orbits, Space+LMB pans.
    const gesture = ImGui.GetIO().KeyAlt || ImGui.IsKeyDown(ImGuiKey._Space);
    this.captured = {
      rect,
      hovered,
      mouse: [m.x, m.y],
      pick: hovered && !gesture && ImGui.IsMouseClicked(0, false),
    };
  }

  /**
   * Resolve a pending pick. `consumedByGizmo` is the gizmo's active state this
   * frame — when set, the click began on (or continues) a gizmo drag and must
   * not re-select, so the pick is skipped. Call from a `postUpdate` system,
   * after the gizmo tick.
   */
  pick(consumedByGizmo: boolean): void {
    const input = this.captured;
    this.captured = null;
    if (input === null || !input.pick || consumedByGizmo) return;

    const editor = findEditorCamera(this.app, this.view);
    if (editor === undefined) return;
    const computed: ComputedCamera = editor.camera.computed;
    const meshes = this.app.getResource(Meshes);
    if (meshes === undefined) return;

    mat4.inverse(computed.viewProjectionMatrix, this.invViewProj);
    Ray.fromScreen(
      input.mouse[0] - input.rect.x,
      input.mouse[1] - input.rect.y,
      0,
      0,
      input.rect.width,
      input.rect.height,
      this.invViewProj,
      this.ray,
    );

    let best: Entity | null = null;
    let bestT = Infinity;
    for (const [entity, mesh3d, global] of this.app.world.query([Mesh3d, GlobalTransform]).entries()) {
      const mesh = meshes.get(mesh3d.handle);
      if (mesh === undefined) continue;
      Aabb.transform(mesh.computeAabb(this.worldAabb), global.matrix, this.worldAabb);
      const t = rayAabbIntersect(this.ray, this.worldAabb);
      if (t !== null && t < bestT) {
        bestT = t;
        best = entity;
      }
    }
    this.state.selectedEntity = best;
    if (best !== null) this.state.selectedAsset = null;
  }
}
