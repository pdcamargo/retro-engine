import type { CameraView } from './camera';

/**
 * Per-frame resource: the active cameras for the current frame in dispatch
 * order. `App.renderFrame()` reads this between the `PhaseSort` and
 * `Cleanup` sub-sets to drive the per-camera render loop.
 *
 * Written by the camera plugin's `prepareCameras` system (`RenderSet.Prepare`)
 * each frame; cleared at the start of the next frame's extract. Each
 * {@link CameraView} is engine-allocated and short-lived — do not retain
 * across frames.
 *
 * Sort rule (`prepareCameras`): ascending `order`; ties broken so off-screen
 * targets (`texture` / `view`) run before on-screen targets
 * (`surface` / `primary`), enabling render-to-texture outputs to feed
 * downstream surface-targeting cameras.
 */
export class SortedCameras {
  /** Ordered list of camera views for the current frame. */
  views: CameraView[] = [];
}
