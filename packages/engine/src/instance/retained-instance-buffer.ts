import type { Renderer } from '@retro-engine/renderer-core';

import { GrowableInstanceStore } from './growable-instance-store';
import { RetainedSlotMap, type Slot } from './retained-slot-map';

/**
 * Retained instance buffer with stable per-entity slots and incremental uploads.
 *
 * Composes a {@link RetainedSlotMap} (entity → stable instance run) with a
 * {@link GrowableInstanceStore} (CPU scratch ± GPU buffer). Callers pack only
 * the instances whose source data changed into {@link scratchF32} /
 * {@link scratchU32} at a slot's float offset, call {@link markDirty}, and
 * {@link flush} uploads the coalesced dirty ranges — replacing the per-frame
 * full repack of the original sprite / mesh instance buffers with O(changed)
 * work in steady state.
 *
 * `gpu: true` (default) allocates a drawable GPU buffer (opaque slot buffers,
 * drawn directly from the slot layout). `gpu: false` keeps only the CPU scratch
 * — a depth-ordered path stages slot bytes here and a {@link SortedSlotIndex}
 * reorders them into its own ordered GPU buffer, so the slot buffer itself is
 * never drawn and needs no GPU allocation.
 *
 * @internal
 */
export class RetainedInstanceBuffer {
  readonly slots = new RetainedSlotMap();
  readonly store: GrowableInstanceStore;
  private readonly gpu: boolean;

  constructor(strideBytes: number, label: string, gpu = true) {
    this.store = new GrowableInstanceStore(strideBytes, label);
    this.gpu = gpu;
  }

  get scratchF32(): Float32Array {
    return this.store.scratchF32;
  }

  get scratchU32(): Uint32Array {
    return this.store.scratchU32;
  }

  /** Allocated capacity in instances. */
  get capacity(): number {
    return this.store.capacity;
  }

  /** Float offset of an instance index within the scratch. */
  floatOffsetOf(instanceIndex: number): number {
    return this.store.floatOffsetOf(instanceIndex);
  }

  /** Record that the `len` instances at `first` were repacked. */
  markDirty(first: number, len: number): void {
    this.store.markDirty(first, len);
  }

  /**
   * Grow scratch (and, when `gpu`, the GPU buffer) to fit the slot map's
   * high-water capacity, preserving scratch contents.
   */
  ensureCapacity(renderer: Renderer): void {
    const required = this.slots.capacityInstances();
    if (this.gpu) this.store.ensureCapacity(renderer, required);
    else this.store.ensureScratch(required);
  }

  /** Upload coalesced dirty ranges (no-op without a GPU buffer). */
  flush(renderer: Renderer): void {
    this.store.flush(renderer);
  }

  /**
   * Repack the slot map to close holes, relocating moved instance bytes in the
   * scratch, and force a full re-upload next {@link flush}. The slot map's
   * `generation` advances, signalling draw-order indexes to rebuild.
   */
  compact(): void {
    this.slots.compact((_entity, oldFirst, newFirst, len) => {
      this.store.relocate(oldFirst, newFirst, len);
    });
    this.store.markFullUpload();
  }

  /** Drop GPU/CPU storage and reset slots. */
  dispose(): void {
    this.store.dispose();
    this.slots.clear();
  }
}

export type { Slot };
