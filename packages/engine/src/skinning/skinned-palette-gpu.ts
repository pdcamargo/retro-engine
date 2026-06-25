import type { Entity } from '@retro-engine/ecs';
import type { BindGroup, BindGroupLayout, Buffer, Renderer } from '@retro-engine/renderer-core';
import { BufferUsage, ShaderStage } from '@retro-engine/renderer-core';

import type { SkinnedPalettes } from './palette';

/** Bytes per joint matrix in the palette storage buffer (`mat4x4<f32>`). */
const MATRIX_BYTE_SIZE = 64;

/**
 * `@group` index the joint-palette storage buffer binds at. view(0) /
 * material(1) / lights(2) / palette(3) fills WebGPU's 4-group budget; SSAO,
 * which also uses group(3), is mutually exclusive with skinning on a view.
 */
export const SKINNED_PALETTE_GROUP = 3 as const;

/**
 * The GPU side of the joint palette: one storage buffer holding every skinned
 * entity's matrices concatenated, the bind group that exposes it at
 * {@link SKINNED_PALETTE_GROUP}, and each entity's base matrix index into it.
 *
 * Frame-global and shared across all skinned draws — the buffer is uploaded once
 * per frame and bound once, so skinned meshes still batch and instance. A
 * render-stage resource, populated from the main-world {@link SkinnedPalettes}.
 * WebGPU-only; gated by `RendererCapabilities.storageBuffers`.
 */
export class SkinnedPaletteGpu {
  layout?: BindGroupLayout;
  buffer?: Buffer;
  bindGroup?: BindGroup;
  private capacityMatrices = 0;
  private scratch = new Float32Array(0);
  /** Base matrix index (palette `joint_offset`) per skinned entity, this frame. */
  readonly offsets = new Map<Entity, number>();

  /** The read-only-storage `@group(3)` layout, created once. */
  ensureLayout(renderer: Renderer): BindGroupLayout {
    if (this.layout === undefined) {
      this.layout = renderer.createBindGroupLayout({
        label: 'skinned-palette',
        entries: [
          {
            binding: 0,
            visibility: ShaderStage.VERTEX,
            buffer: { type: 'read-only-storage' },
          },
        ],
      });
    }
    return this.layout;
  }

  /**
   * Ensure the storage buffer holds at least `matrixCount` matrices, growing
   * (and rebuilding the bind group) when it must. Capacity only grows.
   */
  ensureCapacity(renderer: Renderer, matrixCount: number): void {
    const needed = Math.max(1, matrixCount);
    if (this.buffer !== undefined && this.capacityMatrices >= needed) return;
    let cap = this.capacityMatrices > 0 ? this.capacityMatrices : 16;
    while (cap < needed) cap *= 2;
    this.buffer?.destroy();
    this.buffer = renderer.createBuffer({
      label: 'skinned-palette',
      size: cap * MATRIX_BYTE_SIZE,
      usage: BufferUsage.STORAGE | BufferUsage.COPY_DST,
    });
    this.capacityMatrices = cap;
    this.bindGroup = renderer.createBindGroup({
      label: 'skinned-palette',
      layout: this.ensureLayout(renderer),
      entries: [{ binding: 0, resource: { buffer: this.buffer } }],
    });
  }

  /**
   * Concatenate every per-entity palette into the storage buffer, recording
   * each entity's base matrix index in {@link offsets}, and upload it. A no-op
   * (clearing offsets) when there are no skinned entities this frame.
   */
  writePalettes(renderer: Renderer, palettes: SkinnedPalettes): void {
    this.offsets.clear();
    let total = 0;
    for (const palette of palettes.byEntity.values()) total += palette.jointCount;
    if (total === 0) return;
    this.ensureCapacity(renderer, total);
    if (this.scratch.length < total * 16) this.scratch = new Float32Array(total * 16);
    let cursorMatrices = 0;
    for (const [entity, palette] of palettes.byEntity) {
      this.offsets.set(entity, cursorMatrices);
      this.scratch.set(palette.data, cursorMatrices * 16);
      cursorMatrices += palette.jointCount;
    }
    renderer.writeBuffer(
      this.buffer!,
      0,
      this.scratch.subarray(0, total * 16) as unknown as BufferSource,
    );
  }
}
