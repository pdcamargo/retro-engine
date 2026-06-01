import type { Entity } from '@retro-engine/ecs';

/**
 * Resolved per-camera ambient-occlusion parameters for one frame, as extracted
 * from {@link ScreenSpaceAo}. Read by the prepare system to pack the AO params
 * uniform and by the node to decide whether to run.
 *
 * @internal
 */
export interface AoParams {
  readonly radius: number;
  readonly intensity: number;
  readonly bias: number;
  readonly slices: number;
  readonly steps: number;
}

/**
 * Render-world resource carrying one frame's snapshot of every active camera's
 * ambient-occlusion parameters. Populated in `RenderSet.Extract`; keyed by
 * main-world camera `sourceEntity`. Cleared and repopulated each frame — a
 * camera absent from the current frame's query has no entry, so the pass skips.
 *
 * @internal
 */
export class ViewAo {
  readonly byCamera: Map<Entity, AoParams> = new Map();
}
