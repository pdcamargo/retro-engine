import type { RenderPassEncoder } from '@retro-engine/renderer-core';

import type { RenderContext } from '../index';

/**
 * One drawable item inside a 2D phase. Pushed by `SpritePlugin`'s queue system
 * (and by any future 2D pipeline such as a Phase 8.7 `Material2d`); consumed by
 * the Core2d phase nodes (`OpaquePass2dNode`, `TransparentPass2dNode`) which
 * sort the items by `sortDepth` and invoke each item's `draw` closure against
 * the open pass.
 *
 * Shape-identical to `PhaseItem3d` — the engine's 2D phase plumbing mirrors
 * the 3D plumbing one-for-one so a downstream maintainer learning the 2D path
 * inherits the same mental model.
 *
 * `sortDepth` is the camera-space `z` of the entity's origin (post-view, pre-
 * projection). Smaller values are nearer; opaque/mask sort ascending
 * (front-to-back) — irrelevant for the 2D depth-less pass but kept for shape
 * parity — and transparent sorts descending (back-to-front) for painter's-
 * algorithm compositing.
 */
export interface PhaseItem2d {
  readonly sourceEntity: number;
  readonly sortDepth: number;
  readonly draw: (pass: RenderPassEncoder, ctx: RenderContext) => void;
}

/**
 * Per-camera lists of phase items for the Core2d phase trio. Render-world
 * resource; cleared at the start of each frame's queue stage and populated by
 * every 2D pipeline's queue system.
 *
 * Keyed by main-world camera entity id (the `sourceEntity` on `CameraView`).
 * Phase nodes look up the active camera's lists at render time, sort, and
 * draw. Sprites only write `opaque` and `transparent` in Phase 8.1; the
 * `alphaMask` slot is reserved for an alpha-cutoff sprite pipeline (e.g.
 * tilemaps) that lands alongside the atlas asset.
 */
export class ViewPhases2d {
  readonly opaque: Map<number, PhaseItem2d[]> = new Map();
  readonly alphaMask: Map<number, PhaseItem2d[]> = new Map();
  readonly transparent: Map<number, PhaseItem2d[]> = new Map();

  /** Drop every queued item. Called at the start of the per-frame queue pass. */
  clear(): void {
    this.opaque.clear();
    this.alphaMask.clear();
    this.transparent.clear();
  }

  pushOpaque(cameraEntity: number, item: PhaseItem2d): void {
    const list = this.opaque.get(cameraEntity);
    if (list) list.push(item);
    else this.opaque.set(cameraEntity, [item]);
  }

  pushAlphaMask(cameraEntity: number, item: PhaseItem2d): void {
    const list = this.alphaMask.get(cameraEntity);
    if (list) list.push(item);
    else this.alphaMask.set(cameraEntity, [item]);
  }

  pushTransparent(cameraEntity: number, item: PhaseItem2d): void {
    const list = this.transparent.get(cameraEntity);
    if (list) list.push(item);
    else this.transparent.set(cameraEntity, [item]);
  }
}
