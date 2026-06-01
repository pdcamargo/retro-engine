import type { Entity } from '@retro-engine/ecs';
import type { BindGroup, BindGroupLayout, Sampler, TextureView } from '@retro-engine/renderer-core';
import { ShaderStage } from '@retro-engine/renderer-core';

import type { App } from '../index';

/**
 * Render-world resource owning the opaque pass's `@group(3)` ambient-occlusion
 * read binding: the shared layout (`sampler` at `@binding(0)`, AO
 * `texture_2d<f32>` at `@binding(1)`) plus a per-camera bind group pointing at
 * that camera's final AO texture.
 *
 * The layout is consumed by `MaterialPlugin` when it appends `@group(3)` to a
 * lit material's AO-enabled pipeline variant; the bind group is set on
 * `OpaquePass3dNode` so the forward shader can sample the AO factor. Presence of
 * a per-camera entry is the single source of truth for "AO ran for this camera
 * this frame" — the opaque pipeline variant and the `setBindGroup(3, …)` both
 * gate on it.
 *
 * GPU resource creation is deferred to the first system tick via
 * {@link ensureInitialised}.
 *
 * @internal
 */
export class AoBindGroupCache {
  readLayout: BindGroupLayout | undefined;
  private sampler: Sampler | undefined;
  private readonly perCamera: Map<Entity, { readonly finalView: TextureView; readonly bindGroup: BindGroup }> =
    new Map();
  private initialised = false;

  ensureInitialised(app: App): void {
    if (this.initialised) return;
    const renderer = app.renderer;
    this.sampler = renderer.createSampler({
      label: 'ao-read-sampler',
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });
    this.readLayout = renderer.createBindGroupLayout({
      label: 'ao-read-layout',
      entries: [
        { binding: 0, visibility: ShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        {
          binding: 1,
          visibility: ShaderStage.FRAGMENT,
          texture: { sampleType: 'float', viewDimension: '2d', multisampled: false },
        },
      ],
    });
    this.initialised = true;
  }

  /** True once an opaque-pass camera AO read bind group exists. */
  has(sourceEntity: Entity): boolean {
    return this.perCamera.has(sourceEntity);
  }

  /** The cached `@group(3)` bind group for a camera, or `undefined`. */
  get(sourceEntity: Entity): BindGroup | undefined {
    return this.perCamera.get(sourceEntity)?.bindGroup;
  }

  /**
   * Build (or reuse) the per-camera `@group(3)` bind group for `finalView`.
   * Rebuilds when the AO texture's identity changes (a resize / stage repoint).
   */
  resolve(app: App, sourceEntity: Entity, finalView: TextureView): BindGroup {
    if (this.readLayout === undefined || this.sampler === undefined) {
      throw new Error('AoBindGroupCache.resolve: not initialised — call ensureInitialised first.');
    }
    const cached = this.perCamera.get(sourceEntity);
    if (cached !== undefined && cached.finalView === finalView) {
      return cached.bindGroup;
    }
    if (cached !== undefined) cached.bindGroup.destroy();
    const bindGroup = app.renderer.createBindGroup({
      label: `ao-read#${sourceEntity}`,
      layout: this.readLayout,
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: finalView },
      ],
    });
    this.perCamera.set(sourceEntity, { finalView, bindGroup });
    return bindGroup;
  }

  /** Forget a camera's cached bind group. Called when AO lapses for that camera. */
  invalidate(sourceEntity: Entity): void {
    const cached = this.perCamera.get(sourceEntity);
    if (cached !== undefined) {
      cached.bindGroup.destroy();
      this.perCamera.delete(sourceEntity);
    }
  }

  /** Drop every GPU resource. Tests call this on teardown. */
  dispose(): void {
    for (const entry of this.perCamera.values()) entry.bindGroup.destroy();
    this.perCamera.clear();
    this.sampler?.destroy();
    this.readLayout?.destroy();
    this.sampler = undefined;
    this.readLayout = undefined;
    this.initialised = false;
  }
}
