import type { AssetIndex } from '@retro-engine/assets';
import type { Buffer, IndexFormat, Renderer } from '@retro-engine/renderer-core';
import { BufferUsage } from '@retro-engine/renderer-core';

import type { MeshVertexBufferLayoutRef } from './render-mesh';

/**
 * Per-app tuning for the {@link MeshAllocator}.
 *
 * Defaults are smaller than Bevy's because retro-engine targets browser-scale
 * scenes (KB–MB total mesh data), not AAA-scale ones. Tune by inserting the
 * resource on the `App` before `CorePlugin` runs:
 *
 * ```ts
 * app.insertResource(new MeshAllocatorSettings({ minSlabSize: 256 * 1024 }));
 * ```
 */
export class MeshAllocatorSettings {
  /** Initial byte capacity of a freshly-spawned shared slab. Default 1 MiB. */
  readonly minSlabSize: number;
  /**
   * Maximum byte capacity of any shared slab. When growth would exceed this,
   * a new slab is spawned instead. Default 64 MiB.
   */
  readonly maxSlabSize: number;
  /**
   * Allocation byte-size threshold above which the allocation bypasses shared
   * slabs entirely and gets a dedicated buffer. Default 16 MiB.
   */
  readonly largeThreshold: number;
  /**
   * Factor by which the next slab in a layout's slab list scales up from the
   * previous one (capped by {@link MeshAllocatorSettings.maxSlabSize}).
   * Default 1.5.
   */
  readonly growthFactor: number;

  constructor(options?: {
    minSlabSize?: number;
    maxSlabSize?: number;
    largeThreshold?: number;
    growthFactor?: number;
  }) {
    this.minSlabSize = options?.minSlabSize ?? 1 * 1024 * 1024;
    this.maxSlabSize = options?.maxSlabSize ?? 64 * 1024 * 1024;
    this.largeThreshold = options?.largeThreshold ?? 16 * 1024 * 1024;
    this.growthFactor = options?.growthFactor ?? 1.5;
  }
}

/**
 * Slice of a {@link MeshAllocator}-managed buffer.
 *
 * Consumers read `buffer + offset` to find the bytes for one mesh's data. For
 * vertex slices, `baseVertex` is the slot-relative index the consumer passes
 * as `baseVertex` to {@link RenderPassEncoder.drawIndexed} (always `0` when
 * the allocator routes the slice through a dedicated buffer — either by
 * capability gate or large-threshold).
 */
export interface AllocatorSlice {
  readonly buffer: Buffer;
  /** Byte offset into the buffer where the slice begins. */
  readonly offset: number;
  /** Byte length of the slice. */
  readonly size: number;
  /** Slot-relative base vertex (vertex slices) or base index (index slices). */
  readonly baseVertex: number;
}

const COPY_BUFFER_ALIGNMENT = 4;
const alignUp = (value: number, align: number): number => Math.ceil(value / align) * align;

/**
 * Pad a buffer upload to {@link COPY_BUFFER_ALIGNMENT}. WebGPU's `writeBuffer`
 * rejects a byte length that is not a multiple of 4, and index data can arrive
 * unaligned — a `uint16` index buffer with an odd index count is `2 mod 4`. The
 * allocation is already sized to the same alignment, so the zero-padded write
 * stays in range and the trailing bytes are never indexed.
 */
const padToCopyAlignment = (data: BufferSource): BufferSource => {
  if (data.byteLength % COPY_BUFFER_ALIGNMENT === 0) return data;
  const padded = new Uint8Array(alignUp(data.byteLength, COPY_BUFFER_ALIGNMENT));
  padded.set(
    ArrayBuffer.isView(data)
      ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
      : new Uint8Array(data),
  );
  return padded;
};

interface Slab {
  readonly buffer: Buffer;
  /** Byte capacity. */
  readonly size: number;
  /** Per-mesh ranges (sorted by offset, non-overlapping). */
  readonly ranges: { handle: AssetIndex; offset: number; size: number }[];
  /** Free byte ranges (sorted by offset, non-overlapping, coalesced). */
  readonly free: { offset: number; size: number }[];
}

interface SlabAllocation {
  readonly slab: Slab;
  /** Byte offset into the slab. */
  readonly offset: number;
  /** Byte length. */
  readonly size: number;
}

interface LargeAllocation {
  readonly buffer: Buffer;
  /** Byte length of the dedicated buffer (= the allocation size, aligned up). */
  readonly size: number;
}

type Allocation =
  | { readonly kind: 'slab'; readonly entry: SlabAllocation; readonly baseVertex: number }
  | { readonly kind: 'large'; readonly entry: LargeAllocation };

/**
 * Page-based slab suballocator for mesh vertex / index data.
 *
 * Vertex allocations bucket by {@link MeshVertexBufferLayoutRef} (identity-
 * keyed — meshes that share a layout share a slab list); index allocations
 * bucket by {@link IndexFormat} (`'uint16'` and `'uint32'` allocate into
 * disjoint slab lists because the per-index stride differs). Allocations
 * smaller than `settings.largeThreshold` first-fit into existing slabs,
 * spawning a new slab (1.5× the previous, capped at `maxSlabSize`) when no
 * slab has room. Allocations above the threshold short-circuit to a dedicated
 * buffer.
 *
 * The allocator also gates on the renderer's `baseVertex` capability: when
 * `false` (WebGL2), *every* vertex allocation routes to a dedicated buffer
 * because the backend cannot express a slot-relative base-vertex offset
 * at draw time. Index allocations still pack regardless.
 *
 * Allocations are tracked per {@link AssetIndex}; on `free`, the slab's range
 * is returned to the free list and coalesced with adjacent free ranges. Slabs
 * that drop to fully-empty are destroyed and removed from the slab list.
 */
export class MeshAllocator {
  private readonly renderer: Renderer;
  private readonly settings: MeshAllocatorSettings;
  private readonly canPackVertices: boolean;
  private readonly vertexSlabs = new Map<MeshVertexBufferLayoutRef, Slab[]>();
  private readonly indexSlabs = new Map<IndexFormat, Slab[]>();
  private readonly vertexAllocations = new Map<AssetIndex, Allocation>();
  private readonly indexAllocations = new Map<AssetIndex, Allocation>();

  constructor(renderer: Renderer, settings: MeshAllocatorSettings = new MeshAllocatorSettings()) {
    this.renderer = renderer;
    this.settings = settings;
    this.canPackVertices = renderer.capabilities.baseVertex;
  }

  /**
   * Reserve space for one mesh's packed vertex bytes.
   *
   * The allocator uploads via {@link Renderer.writeBuffer}; the caller can
   * subsequently fetch the live slice with {@link MeshAllocator.vertexSlice}.
   *
   * Re-allocating against the same handle is a programming error — call
   * {@link MeshAllocator.freeVertex} first (the {@link MeshPlugin} pipeline
   * does this automatically on `Modified` events).
   */
  allocateVertex(handle: AssetIndex, layout: MeshVertexBufferLayoutRef, data: BufferSource): void {
    if (this.vertexAllocations.has(handle)) {
      throw new Error(`MeshAllocator.allocateVertex: handle ${handle} already has a vertex allocation`);
    }
    const size = alignUp(data.byteLength, COPY_BUFFER_ALIGNMENT);
    const useLarge = !this.canPackVertices || size >= this.settings.largeThreshold;
    const allocation = useLarge
      ? this.allocateLarge(handle, size, BufferUsage.VERTEX | BufferUsage.COPY_DST, 'mesh-allocator/vertex-large')
      : this.allocateSlab(handle, this.vertexSlabsFor(layout), size, layout.stride, BufferUsage.VERTEX | BufferUsage.COPY_DST, 'mesh-allocator/vertex');
    this.vertexAllocations.set(handle, allocation);
    this.write(allocation, data);
  }

  /**
   * Reserve space for one mesh's packed index bytes.
   *
   * Index width selects the slab list: `'uint16'` indices pack against other
   * `u16` meshes; `'uint32'` against other `u32` meshes.
   */
  allocateIndex(handle: AssetIndex, format: IndexFormat, data: BufferSource): void {
    if (this.indexAllocations.has(handle)) {
      throw new Error(`MeshAllocator.allocateIndex: handle ${handle} already has an index allocation`);
    }
    const stride = format === 'uint16' ? 2 : 4;
    const size = alignUp(data.byteLength, COPY_BUFFER_ALIGNMENT);
    const useLarge = size >= this.settings.largeThreshold;
    const allocation = useLarge
      ? this.allocateLarge(handle, size, BufferUsage.INDEX | BufferUsage.COPY_DST, 'mesh-allocator/index-large')
      : this.allocateSlab(handle, this.indexSlabsFor(format), size, stride, BufferUsage.INDEX | BufferUsage.COPY_DST, 'mesh-allocator/index');
    this.indexAllocations.set(handle, allocation);
    this.write(allocation, data);
  }

  /**
   * Release the vertex allocation for `handle`, returning its range to the
   * free list (or destroying its dedicated buffer for a large allocation).
   * Silent no-op when the handle has no vertex allocation.
   */
  freeVertex(handle: AssetIndex): void {
    const allocation = this.vertexAllocations.get(handle);
    if (!allocation) return;
    this.vertexAllocations.delete(handle);
    this.freeAllocation(handle, allocation, this.vertexSlabs);
  }

  /** Release the index allocation for `handle`. Silent no-op when none exists. */
  freeIndex(handle: AssetIndex): void {
    const allocation = this.indexAllocations.get(handle);
    if (!allocation) return;
    this.indexAllocations.delete(handle);
    this.freeAllocation(handle, allocation, this.indexSlabs);
  }

  /**
   * Resolve the GPU slice backing the mesh's vertex data. Returns `undefined`
   * if no vertex allocation exists for `handle`.
   */
  vertexSlice(handle: AssetIndex): AllocatorSlice | undefined {
    return this.sliceFor(this.vertexAllocations.get(handle));
  }

  /** Resolve the GPU slice backing the mesh's index data. */
  indexSlice(handle: AssetIndex): AllocatorSlice | undefined {
    return this.sliceFor(this.indexAllocations.get(handle));
  }

  /** Number of vertex slabs currently allocated, across all layouts. Diagnostic only. */
  get vertexSlabCount(): number {
    let count = 0;
    for (const slabs of this.vertexSlabs.values()) count += slabs.length;
    return count;
  }

  /** Number of index slabs currently allocated, across all index formats. Diagnostic only. */
  get indexSlabCount(): number {
    let count = 0;
    for (const slabs of this.indexSlabs.values()) count += slabs.length;
    return count;
  }

  /** Number of dedicated large-allocation buffers in flight. Diagnostic only. */
  get largeAllocationCount(): number {
    let count = 0;
    for (const allocation of this.vertexAllocations.values()) {
      if (allocation.kind === 'large') count++;
    }
    for (const allocation of this.indexAllocations.values()) {
      if (allocation.kind === 'large') count++;
    }
    return count;
  }

  private vertexSlabsFor(layout: MeshVertexBufferLayoutRef): Slab[] {
    let slabs = this.vertexSlabs.get(layout);
    if (!slabs) {
      slabs = [];
      this.vertexSlabs.set(layout, slabs);
    }
    return slabs;
  }

  private indexSlabsFor(format: IndexFormat): Slab[] {
    let slabs = this.indexSlabs.get(format);
    if (!slabs) {
      slabs = [];
      this.indexSlabs.set(format, slabs);
    }
    return slabs;
  }

  private allocateSlab(
    handle: AssetIndex,
    slabs: Slab[],
    size: number,
    stride: number,
    usage: number,
    label: string,
  ): Allocation {
    for (const slab of slabs) {
      const offset = this.takeFreeRange(slab, size);
      if (offset !== undefined) {
        slab.ranges.push({ handle, offset, size });
        slab.ranges.sort((a, b) => a.offset - b.offset);
        return { kind: 'slab', entry: { slab, offset, size }, baseVertex: offset / stride };
      }
    }
    // Spawn a new slab. Size = max(minSlabSize, prev * growthFactor, alignment-padded request),
    // clamped to maxSlabSize.
    const prevSize = slabs.length > 0 ? slabs[slabs.length - 1]!.size : 0;
    const grown = Math.floor(prevSize * this.settings.growthFactor);
    let newSlabSize = Math.max(this.settings.minSlabSize, grown, size);
    if (newSlabSize > this.settings.maxSlabSize) newSlabSize = Math.max(this.settings.maxSlabSize, size);
    newSlabSize = alignUp(newSlabSize, COPY_BUFFER_ALIGNMENT);
    const buffer = this.renderer.createBuffer({ size: newSlabSize, usage, label });
    const slab: Slab = {
      buffer,
      size: newSlabSize,
      ranges: [{ handle, offset: 0, size }],
      free: size < newSlabSize ? [{ offset: size, size: newSlabSize - size }] : [],
    };
    slabs.push(slab);
    return { kind: 'slab', entry: { slab, offset: 0, size }, baseVertex: 0 };
  }

  private allocateLarge(handle: AssetIndex, size: number, usage: number, label: string): Allocation {
    // Suppress unused-parameter; `handle` is part of the API for symmetry with slab path.
    void handle;
    const buffer = this.renderer.createBuffer({ size, usage, label });
    return { kind: 'large', entry: { buffer, size } };
  }

  /**
   * Try to carve `size` bytes out of `slab`'s free list. First-fit. Returns
   * the chosen offset (and updates the free list in place) or `undefined`
   * when no range is large enough.
   */
  private takeFreeRange(slab: Slab, size: number): number | undefined {
    for (let i = 0; i < slab.free.length; i++) {
      const range = slab.free[i]!;
      if (range.size >= size) {
        const offset = range.offset;
        if (range.size === size) {
          slab.free.splice(i, 1);
        } else {
          slab.free[i] = { offset: range.offset + size, size: range.size - size };
        }
        return offset;
      }
    }
    return undefined;
  }

  private write(allocation: Allocation, data: BufferSource): void {
    const padded = padToCopyAlignment(data);
    if (allocation.kind === 'slab') {
      this.renderer.writeBuffer(allocation.entry.slab.buffer, allocation.entry.offset, padded);
    } else {
      this.renderer.writeBuffer(allocation.entry.buffer, 0, padded);
    }
  }

  private freeAllocation(
    handle: AssetIndex,
    allocation: Allocation,
    slabRegistry: Map<unknown, Slab[]>,
  ): void {
    if (allocation.kind === 'large') {
      allocation.entry.buffer.destroy();
      return;
    }
    const slab = allocation.entry.slab;
    const idx = slab.ranges.findIndex((r) => r.handle === handle);
    if (idx >= 0) slab.ranges.splice(idx, 1);
    this.returnRangeToFreeList(slab, allocation.entry.offset, allocation.entry.size);
    if (slab.ranges.length === 0) {
      slab.buffer.destroy();
      for (const slabs of slabRegistry.values()) {
        const slabIdx = slabs.indexOf(slab);
        if (slabIdx >= 0) {
          slabs.splice(slabIdx, 1);
          break;
        }
      }
    }
  }

  /**
   * Insert `(offset, size)` into the slab's free list, coalescing with any
   * adjacent free range on either side. Free list stays sorted by offset.
   */
  private returnRangeToFreeList(slab: Slab, offset: number, size: number): void {
    const list = slab.free;
    let i = 0;
    while (i < list.length && list[i]!.offset < offset) i++;
    // Try to coalesce with the previous range.
    if (i > 0 && list[i - 1]!.offset + list[i - 1]!.size === offset) {
      list[i - 1] = { offset: list[i - 1]!.offset, size: list[i - 1]!.size + size };
      // Then with the following range.
      if (i < list.length && list[i - 1]!.offset + list[i - 1]!.size === list[i]!.offset) {
        list[i - 1] = { offset: list[i - 1]!.offset, size: list[i - 1]!.size + list[i]!.size };
        list.splice(i, 1);
      }
      return;
    }
    // Try to coalesce with the following range.
    if (i < list.length && offset + size === list[i]!.offset) {
      list[i] = { offset, size: size + list[i]!.size };
      return;
    }
    list.splice(i, 0, { offset, size });
  }

  private sliceFor(allocation: Allocation | undefined): AllocatorSlice | undefined {
    if (!allocation) return undefined;
    if (allocation.kind === 'slab') {
      return {
        buffer: allocation.entry.slab.buffer,
        offset: allocation.entry.offset,
        size: allocation.entry.size,
        baseVertex: allocation.baseVertex,
      };
    }
    return {
      buffer: allocation.entry.buffer,
      offset: 0,
      size: allocation.entry.size,
      baseVertex: 0,
    };
  }
}
