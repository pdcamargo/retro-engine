import type { RenderPassEncoder } from '@retro-engine/renderer-core';

import type { RenderContext } from '../index';

/**
 * One drawable item inside a 3D phase. Pushed by `MaterialPlugin<M>`'s queue
 * system; consumed by the Core3d phase nodes (`OpaquePass3d`,
 * `TransparentPass3d`) which sort the items by `sortDepth` and invoke each
 * item's `draw` closure against the open pass.
 *
 * The closure captures everything it needs to record one draw — pipeline,
 * material bind group, per-entity transform bind group, mesh slices, draw
 * counts. Closures-per-frame are wasteful but explicit; an instance-batching
 * optimization can replace them later without changing the phase shape.
 *
 * `sortDepth` is the camera-space `z` of the entity's origin (post-view, pre-
 * projection). Smaller values are nearer; opaque/mask sort ascending
 * (front-to-back) for early-Z efficiency; transparent sorts descending
 * (back-to-front) for compositing correctness.
 */
export interface PhaseItem3d {
  readonly sourceEntity: number;
  readonly sortDepth: number;
  readonly draw: (pass: RenderPassEncoder, ctx: RenderContext) => void;
}

/**
 * Per-camera lists of phase items for the Core3d phase trio. Render-world
 * resource; cleared at the start of each frame's queue stage and populated
 * by every `MaterialPlugin<M>`'s `queueMaterials3d` system.
 *
 * Keyed by main-world camera entity id (the `sourceEntity` on `CameraView`).
 * Phase nodes look up the active camera's lists at render time, sort, and
 * draw.
 */
export class ViewPhases3d {
  readonly opaque: Map<number, PhaseItem3d[]> = new Map();
  readonly alphaMask: Map<number, PhaseItem3d[]> = new Map();
  readonly transparent: Map<number, PhaseItem3d[]> = new Map();
  /**
   * Items drawn by `PrepassNode3d` before the opaque pass. Sorted
   * front-to-back at draw time (cheap early-Z, matching the opaque pass).
   * Populated only by materials whose {@link Material.prepassWrites}
   * intersects the camera's enabled prepass flags.
   */
  readonly prepass: Map<number, PhaseItem3d[]> = new Map();

  /** Drop every queued item. Called at the start of the per-frame queue pass. */
  clear(): void {
    this.opaque.clear();
    this.alphaMask.clear();
    this.transparent.clear();
    this.prepass.clear();
  }

  pushOpaque(cameraEntity: number, item: PhaseItem3d): void {
    const list = this.opaque.get(cameraEntity);
    if (list) list.push(item);
    else this.opaque.set(cameraEntity, [item]);
  }

  pushAlphaMask(cameraEntity: number, item: PhaseItem3d): void {
    const list = this.alphaMask.get(cameraEntity);
    if (list) list.push(item);
    else this.alphaMask.set(cameraEntity, [item]);
  }

  pushTransparent(cameraEntity: number, item: PhaseItem3d): void {
    const list = this.transparent.get(cameraEntity);
    if (list) list.push(item);
    else this.transparent.set(cameraEntity, [item]);
  }

  pushPrepass(cameraEntity: number, item: PhaseItem3d): void {
    const list = this.prepass.get(cameraEntity);
    if (list) list.push(item);
    else this.prepass.set(cameraEntity, [item]);
  }
}
