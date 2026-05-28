import type { Entity } from '@retro-engine/ecs';

import type { TonemappingMethod } from './tonemapping';

/**
 * Render-world resource carrying one frame's snapshot of every active
 * camera's `Tonemapping.method`. Populated by `extractTonemapping` in
 * `RenderSet.Extract`; read by `TonemappingNode` to look up the operator
 * for the camera currently dispatching. Keyed by main-world camera
 * `sourceEntity` (stable across frames).
 *
 * Cleared and repopulated each frame — cameras absent from the current
 * frame's main-world query simply have no entry, so the node skips them.
 *
 * @internal
 */
export class ViewTonemapping {
  readonly byCamera: Map<Entity, TonemappingMethod> = new Map();
}
