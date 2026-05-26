import type { Buffer, Renderer } from '@retro-engine/renderer-core';
import { BufferUsage } from '@retro-engine/renderer-core';

const MIN_CAPACITY = 64 as const;
const GROWTH_FACTOR = 1.5 as const;
/**
 * When the instances rewritten this frame exceed this fraction of the used
 * range, one full `writeBuffer` beats many small partial uploads (each carries
 * fixed per-call overhead). Below it, partial uploads of only the dirty ranges
 * win.
 */
const FULL_UPLOAD_FRACTION = 0.5 as const;

/** A coalesced run of dirty instances to upload, half-open `[first, end)`. */
interface DirtyRun {
  first: number;
  end: number;
}

/**
 * Growable instance store: a CPU scratch mirror backing an optional
 * `BufferUsage.VERTEX | BufferUsage.COPY_DST` GPU buffer, with incremental
 * (dirty-range) uploads.
 *
 * Callers pack per-instance data into {@link scratchF32} / {@link scratchU32} at
 * an instance's float offset, call {@link markDirty}, and {@link flush}
 * coalesces the dirty runs into the fewest `writeBuffer` calls — partial uploads
 * when little changed, one full upload when most did or the buffer was just
 * (re)allocated.
 *
 * Two growth modes share the scratch logic:
 * - {@link ensureCapacity} allocates / grows the GPU buffer (for a buffer that
 *   is drawn — opaque slot buffers, per-camera ordered buffers).
 * - {@link ensureScratch} grows only the CPU mirror (for a slot staging area
 *   whose bytes are reordered into a separate ordered buffer and never drawn
 *   directly, so no GPU buffer is allocated).
 *
 * Growth follows the engine's instance-buffer precedent: 1.5× capacity bump,
 * minimum {@link MIN_CAPACITY} instances, prior GPU buffer quarantined in
 * `pendingDestroy` for one frame (WebGPU rejects destroying a buffer still
 * referenced by an in-flight submission). Scratch contents are preserved across
 * a grow — retained data must outlive the resize.
 *
 * @internal
 */
export class GrowableInstanceStore {
  buffer: Buffer | undefined;
  /** Allocated capacity in instances (each = `strideBytes` wide). */
  capacity = 0;
  /** Holds the prior frame's buffer for one tick post-resize; destroyed at the next ensure. */
  pendingDestroy: Buffer | undefined;
  /** CPU mirror, sized in floats; grows alongside the buffer, contents preserved. */
  scratchF32: Float32Array = new Float32Array(0);
  /** Aliased view of {@link scratchF32}'s `ArrayBuffer` for packed-integer slots (e.g. sprite RGBA). */
  scratchU32: Uint32Array = new Uint32Array(0);

  readonly floatsPerInstance: number;
  readonly strideBytes: number;
  private readonly label: string;
  private readonly dirty: DirtyRun[] = [];
  private dirtyInstances = 0;
  /** Instances in the active range — full-upload extent and the dirty-volume denominator. */
  private used = 0;
  /** Set when a fresh GPU buffer (empty) means the whole mirror must re-upload. */
  private fullUpload = false;

  /**
   * @param strideBytes Per-instance byte size (must be a multiple of 4); 44 for
   *   sprites, 128 for mesh transforms.
   * @param label Debug label for the GPU buffer.
   */
  constructor(strideBytes: number, label: string) {
    this.strideBytes = strideBytes;
    this.floatsPerInstance = strideBytes / 4;
    this.label = label;
  }

  /** Float offset of an instance index within {@link scratchF32} / {@link scratchU32}. */
  floatOffsetOf(instanceIndex: number): number {
    return instanceIndex * this.floatsPerInstance;
  }

  /**
   * Record that the `len` instances starting at `first` were repacked and must
   * be uploaded by the next {@link flush}.
   */
  markDirty(first: number, len: number): void {
    this.dirty.push({ first, end: first + len });
    this.dirtyInstances += len;
  }

  /** Force the next {@link flush} to re-upload the whole used range. */
  markFullUpload(): void {
    this.fullUpload = true;
  }

  /** Move `len` instances' bytes within the scratch (memmove semantics). */
  relocate(fromInstance: number, toInstance: number, len: number): void {
    const from = fromInstance * this.floatsPerInstance;
    const to = toInstance * this.floatsPerInstance;
    this.scratchF32.copyWithin(to, from, from + len * this.floatsPerInstance);
  }

  /**
   * Copy `len` instances from `source`'s scratch (starting at `sourceFirst`)
   * into this store's scratch at `destFirst`, and mark the destination range
   * dirty. Used to project slot-buffer bytes into draw order.
   */
  copyFrom(source: GrowableInstanceStore, sourceFirst: number, destFirst: number, len: number): void {
    const srcStart = sourceFirst * this.floatsPerInstance;
    const dstStart = destFirst * this.floatsPerInstance;
    const floats = len * this.floatsPerInstance;
    this.scratchF32.set(source.scratchF32.subarray(srcStart, srcStart + floats), dstStart);
    this.markDirty(destFirst, len);
  }

  /**
   * Grow the GPU buffer and scratch to fit `requiredInstances`, preserving
   * scratch contents and reaping the prior frame's deferred-destroy buffer.
   * Sets the used range to `requiredInstances`. Idempotent when already large
   * enough.
   */
  ensureCapacity(renderer: Renderer, requiredInstances: number): void {
    this.used = requiredInstances;
    if (this.pendingDestroy !== undefined) {
      this.pendingDestroy.destroy();
      this.pendingDestroy = undefined;
    }
    if (requiredInstances <= this.capacity && this.buffer !== undefined) return;
    const newCapacity = this.grownCapacity(requiredInstances);
    const fresh = renderer.createBuffer({
      label: this.label,
      size: newCapacity * this.strideBytes,
      usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
    });
    if (this.buffer !== undefined) this.pendingDestroy = this.buffer;
    this.buffer = fresh;
    this.capacity = newCapacity;
    this.growScratch(newCapacity);
    this.fullUpload = true; // the new GPU buffer is empty; seed it from the mirror
  }

  /**
   * Grow only the CPU scratch to fit `requiredInstances` (no GPU buffer). For a
   * slot staging area that is reordered into a separate buffer.
   */
  ensureScratch(requiredInstances: number): void {
    this.used = requiredInstances;
    if (requiredInstances <= this.capacity) return;
    this.capacity = this.grownCapacity(requiredInstances);
    this.growScratch(this.capacity);
  }

  /**
   * Upload everything dirtied since the last flush. Coalesces touching /
   * overlapping dirty runs into the fewest partial `writeBuffer` calls, unless a
   * full upload is pending or the dirty volume exceeds
   * {@link FULL_UPLOAD_FRACTION} of the used range — then one full upload.
   */
  flush(renderer: Renderer): void {
    if (this.buffer === undefined) {
      this.resetDirty();
      return;
    }
    if (this.fullUpload || this.dirtyInstances > this.used * FULL_UPLOAD_FRACTION) {
      if (this.used > 0) this.upload(renderer, 0, this.used);
    } else if (this.dirty.length > 0) {
      this.dirty.sort((a, b) => a.first - b.first);
      let { first, end } = this.dirty[0]!;
      for (let i = 1; i < this.dirty.length; i++) {
        const run = this.dirty[i]!;
        if (run.first <= end) {
          if (run.end > end) end = run.end;
        } else {
          this.upload(renderer, first, end);
          first = run.first;
          end = run.end;
        }
      }
      this.upload(renderer, first, end);
    }
    this.resetDirty();
  }

  /** Drop the GPU buffer + any pending-destroy slot and reset to empty. */
  dispose(): void {
    if (this.pendingDestroy !== undefined) {
      this.pendingDestroy.destroy();
      this.pendingDestroy = undefined;
    }
    if (this.buffer !== undefined) {
      this.buffer.destroy();
      this.buffer = undefined;
    }
    this.capacity = 0;
    this.resetDirty();
  }

  private grownCapacity(required: number): number {
    let next = this.capacity > 0 ? this.capacity : MIN_CAPACITY;
    while (next < required) {
      next = Math.max(next + 1, Math.ceil(next * GROWTH_FACTOR));
    }
    return next;
  }

  private growScratch(capacityInstances: number): void {
    const newFloatLen = capacityInstances * this.floatsPerInstance;
    if (this.scratchF32.length >= newFloatLen) return;
    const ab = new ArrayBuffer(newFloatLen * 4);
    const grown = new Float32Array(ab);
    grown.set(this.scratchF32); // retained instance data must survive the resize
    this.scratchF32 = grown;
    this.scratchU32 = new Uint32Array(ab);
  }

  private upload(renderer: Renderer, firstInstance: number, endInstance: number): void {
    const view = this.scratchF32.subarray(
      firstInstance * this.floatsPerInstance,
      endInstance * this.floatsPerInstance,
    );
    renderer.writeBuffer(this.buffer!, firstInstance * this.strideBytes, view as unknown as BufferSource);
  }

  private resetDirty(): void {
    this.dirty.length = 0;
    this.dirtyInstances = 0;
    this.fullUpload = false;
  }
}
