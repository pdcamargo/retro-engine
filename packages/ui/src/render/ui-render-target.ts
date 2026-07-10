import type { App, CameraView } from '@retro-engine/engine';
import type { ResolvedRenderTarget, TextureView } from '@retro-engine/renderer-core';

/**
 * Per-frame resource holding the render target the UI passes draw into, resolved
 * from the {@link import('../ui-camera').UiCamera} camera each frame. `null` when
 * no UI camera is present; the pass nodes then fall back to the full-surface
 * overlay only if {@link UiRenderTargetState.overlayFallback} is set.
 *
 * Do not retain `target` across frames — its `view` is valid only for the frame
 * it was resolved on (surface views are re-acquired each frame).
 */
export class UiRenderTargetState {
  /** The UI camera's resolved target for this frame, or `null` if none. */
  target: ResolvedRenderTarget | null = null;
  /**
   * Whether, with no UI camera, the passes should draw a full-surface overlay
   * (the pre-camera-bound behavior). Games leave this `true`; hosts that render
   * into offscreen textures (the studio) set it `false` so the UI never draws
   * over their own surface.
   */
  overlayFallback = true;
}

/**
 * Choose the single UI camera view for this frame from the dispatch-ordered
 * `views`: the first view whose camera is marked and is also the main camera,
 * else the first marked camera in dispatch order, else `undefined`. Pure.
 *
 * @param uiCameras - source entity ids of cameras carrying `UiCamera`.
 * @param mainCameras - source entity ids of cameras carrying `MainCamera`.
 * @param views - the frame's cameras in dispatch order.
 */
export const pickUiCameraView = (
  uiCameras: ReadonlySet<number>,
  mainCameras: ReadonlySet<number>,
  views: readonly CameraView[],
): CameraView | undefined => {
  let firstMarked: CameraView | undefined;
  for (const view of views) {
    if (!uiCameras.has(view.sourceEntity)) continue;
    if (mainCameras.has(view.sourceEntity)) return view;
    if (firstMarked === undefined) firstMarked = view;
  }
  return firstMarked;
};

/**
 * The texture view the UI passes should draw into this frame: the resolved UI
 * camera target if one exists, else the primary surface when the overlay fallback
 * is enabled, else `undefined` (the passes skip). Valid only for the current
 * frame.
 */
export const uiTargetView = (app: App): TextureView | undefined => {
  const state = app.getResource(UiRenderTargetState);
  if (state?.target != null) return state.target.view;
  if (state !== undefined && !state.overlayFallback) return undefined;
  return app.getSurface()?.getCurrentTextureView();
};
