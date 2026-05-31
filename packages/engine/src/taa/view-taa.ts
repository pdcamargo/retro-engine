import type { Entity } from '@retro-engine/ecs';

/**
 * Resolved per-camera TAA parameters for one frame, as consumed by the resolve
 * shader.
 *
 * @internal
 */
export interface TaaParams {
  /** History blend weight toward the current frame, `0..1`. */
  readonly blend: number;
}

/**
 * Render-world resource carrying one frame's snapshot of every active camera's
 * TAA parameters. Populated in `RenderSet.Extract`; read by the prepare system
 * (to write the params uniform) and the node (to decide whether to run). Keyed
 * by main-world camera `sourceEntity`.
 *
 * Cleared and repopulated each frame — a camera absent from the current frame's
 * query simply has no entry, so the resolve skips it.
 *
 * @internal
 */
export class ViewTaa {
  readonly byCamera: Map<Entity, TaaParams> = new Map();
}
