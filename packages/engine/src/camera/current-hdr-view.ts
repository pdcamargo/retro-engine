import type { Entity } from '@retro-engine/ecs';
import type { TextureView } from '@retro-engine/renderer-core';

/**
 * The most recently produced HDR color view for each camera this frame — the
 * handoff between the chain of HDR post-processing passes.
 *
 * Seeded in `RenderSet.Prepare` to each HDR camera's scene intermediate
 * (`CameraView.mainColorTarget`). Every HDR post pass reads the current entry
 * as its input, renders into its own intermediate, then stores that intermediate
 * back — so the passes compose in graph order without any one of them knowing
 * which others are installed. The terminal tonemap pass reads the final entry
 * and writes the camera's LDR target without updating it.
 *
 * Keyed by main-world camera `sourceEntity`. Only HDR cameras get an entry; a
 * non-HDR camera writes straight to its final (non-sampleable) target, so no
 * post pass runs for it and consumers fall back to `mainColorTarget`.
 *
 * Cleared and reseeded each frame.
 *
 * @internal
 */
export class CurrentHdrView {
  /** Per-source-entity latest HDR color view. */
  readonly perCamera: Map<Entity, TextureView> = new Map();
}
