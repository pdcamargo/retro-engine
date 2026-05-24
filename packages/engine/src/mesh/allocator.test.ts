import { describe, expect, it } from 'bun:test';

import type {
  Buffer,
  BufferDescriptor,
  Renderer,
  RendererCapabilities,
} from '@retro-engine/renderer-core';

import { MeshAllocator, MeshAllocatorSettings } from './allocator';
import type { MeshHandle } from './meshes';
import { interMeshVertexBufferLayout } from './render-mesh';
import { MeshAttribute } from './vertex-attribute';

const asHandle = (n: number): MeshHandle => n as MeshHandle;

interface FakeBuffer extends Buffer {
  destroyed: boolean;
}

const makeFakeRenderer = (overrides?: Partial<RendererCapabilities>): Renderer & {
  buffers: FakeBuffer[];
} => {
  const buffers: FakeBuffer[] = [];
  const capabilities: RendererCapabilities = {
    computeShaders: false,
    storageTextures: false,
    timestampQueries: false,
    indirectDraw: false,
    bgra8UnormStorage: false,
    baseVertex: true,
    ...overrides,
  };
  // Cast through unknown — we only need the createBuffer / writeBuffer surface
  // for these tests; the rest is unused and gets stubbed with throwing fns.
  const renderer = {
    capabilities,
    createBuffer(descriptor: BufferDescriptor): Buffer {
      const buf: FakeBuffer = {
        size: descriptor.size,
        usage: descriptor.usage,
        destroyed: false,
        destroy(): void {
          this.destroyed = true;
        },
      };
      buffers.push(buf);
      return buf;
    },
    writeBuffer(): void {
      // No-op — tests don't validate written bytes (the contents are
      // packed-interleaved bytes the consumer hands in).
    },
    init: () => Promise.resolve(),
    destroy: () => undefined,
    getPreferredSurfaceFormat: () => 'rgba8unorm' as const,
    createSurface: (() => undefined) as never,
    createShaderModule: (() => undefined) as never,
    createTexture: (() => undefined) as never,
    createSampler: (() => undefined) as never,
    writeTexture: () => undefined,
    createBindGroupLayout: (() => undefined) as never,
    createPipelineLayout: (() => undefined) as never,
    createBindGroup: (() => undefined) as never,
    createRenderPipeline: (() => undefined) as never,
    createCommandEncoder: (() => undefined) as never,
    resolveRenderTarget: (() => undefined) as never,
    submit: () => undefined,
  } as unknown as Renderer & { buffers: FakeBuffer[] };
  (renderer as { buffers: FakeBuffer[] }).buffers = buffers;
  return renderer;
};

const positionLayout = interMeshVertexBufferLayout([MeshAttribute.POSITION]);
const posUvLayout = interMeshVertexBufferLayout([MeshAttribute.POSITION, MeshAttribute.UV_0]);

describe('MeshAllocator vertex allocation', () => {
  it('first vertex allocation spawns one slab', () => {
    const renderer = makeFakeRenderer();
    const allocator = new MeshAllocator(renderer, new MeshAllocatorSettings({ minSlabSize: 4096 }));
    const data = new Float32Array(9); // 3 vertices × float32x3 = 36 bytes
    allocator.allocateVertex(asHandle(1), positionLayout, data);
    expect(allocator.vertexSlabCount).toBe(1);
    expect(renderer.buffers).toHaveLength(1);
    const slice = allocator.vertexSlice(asHandle(1))!;
    expect(slice.offset).toBe(0);
    expect(slice.baseVertex).toBe(0);
    expect(slice.size).toBe(36);
  });

  it('two allocations with the same layout pack into one slab', () => {
    const renderer = makeFakeRenderer();
    const allocator = new MeshAllocator(renderer, new MeshAllocatorSettings({ minSlabSize: 4096 }));
    allocator.allocateVertex(asHandle(1), positionLayout, new Float32Array(9));
    allocator.allocateVertex(asHandle(2), positionLayout, new Float32Array(9));
    expect(allocator.vertexSlabCount).toBe(1);
    expect(renderer.buffers).toHaveLength(1);
    const slice2 = allocator.vertexSlice(asHandle(2))!;
    expect(slice2.offset).toBe(36); // immediately after the first
    expect(slice2.baseVertex).toBe(3); // offset / stride (= 12)
  });

  it('two allocations with different layouts get separate slabs', () => {
    const renderer = makeFakeRenderer();
    const allocator = new MeshAllocator(renderer, new MeshAllocatorSettings({ minSlabSize: 4096 }));
    allocator.allocateVertex(asHandle(1), positionLayout, new Float32Array(9));
    allocator.allocateVertex(asHandle(2), posUvLayout, new Float32Array(15));
    expect(allocator.vertexSlabCount).toBe(2);
    expect(renderer.buffers).toHaveLength(2);
  });

  it('free returns the range to the free list; re-allocate reuses it', () => {
    const renderer = makeFakeRenderer();
    const allocator = new MeshAllocator(renderer, new MeshAllocatorSettings({ minSlabSize: 4096 }));
    allocator.allocateVertex(asHandle(1), positionLayout, new Float32Array(9)); // 36 bytes
    allocator.allocateVertex(asHandle(2), positionLayout, new Float32Array(9)); // 36 bytes
    allocator.freeVertex(asHandle(1));
    expect(allocator.vertexSlabCount).toBe(1);
    allocator.allocateVertex(asHandle(3), positionLayout, new Float32Array(9));
    const slice3 = allocator.vertexSlice(asHandle(3))!;
    expect(slice3.offset).toBe(0); // reused the freed range
    expect(renderer.buffers).toHaveLength(1); // no new slab spawned
  });

  it('spawns a new slab when the current one cannot fit a new request', () => {
    const renderer = makeFakeRenderer();
    const allocator = new MeshAllocator(
      renderer,
      new MeshAllocatorSettings({ minSlabSize: 64, maxSlabSize: 64 }),
    );
    // First allocation fills the slab exactly.
    allocator.allocateVertex(asHandle(1), positionLayout, new Float32Array(16)); // 64 bytes
    expect(allocator.vertexSlabCount).toBe(1);
    // Second allocation can't fit, spawns a new slab.
    allocator.allocateVertex(asHandle(2), positionLayout, new Float32Array(16)); // 64 bytes
    expect(allocator.vertexSlabCount).toBe(2);
    expect(renderer.buffers).toHaveLength(2);
  });

  it('large allocation bypasses slabs (dedicated buffer)', () => {
    const renderer = makeFakeRenderer();
    const allocator = new MeshAllocator(
      renderer,
      new MeshAllocatorSettings({ minSlabSize: 1024, largeThreshold: 256 }),
    );
    // 64 floats × 4 = 256 bytes, hits the threshold exactly.
    allocator.allocateVertex(asHandle(1), positionLayout, new Float32Array(64));
    expect(allocator.vertexSlabCount).toBe(0);
    expect(allocator.largeAllocationCount).toBe(1);
    const slice = allocator.vertexSlice(asHandle(1))!;
    expect(slice.offset).toBe(0);
    expect(slice.baseVertex).toBe(0);
  });

  it('freeing a large allocation destroys its dedicated buffer', () => {
    const renderer = makeFakeRenderer();
    const allocator = new MeshAllocator(
      renderer,
      new MeshAllocatorSettings({ minSlabSize: 1024, largeThreshold: 256 }),
    );
    allocator.allocateVertex(asHandle(1), positionLayout, new Float32Array(64));
    const buffer = renderer.buffers[0]!;
    allocator.freeVertex(asHandle(1));
    expect(buffer.destroyed).toBe(true);
    expect(allocator.largeAllocationCount).toBe(0);
  });

  it('baseVertex = false routes every vertex allocation to a dedicated buffer', () => {
    const renderer = makeFakeRenderer({ baseVertex: false });
    const allocator = new MeshAllocator(renderer, new MeshAllocatorSettings({ minSlabSize: 4096 }));
    allocator.allocateVertex(asHandle(1), positionLayout, new Float32Array(9));
    allocator.allocateVertex(asHandle(2), positionLayout, new Float32Array(9));
    expect(allocator.vertexSlabCount).toBe(0);
    expect(allocator.largeAllocationCount).toBe(2);
  });

  it('throws on double-allocate for the same handle', () => {
    const renderer = makeFakeRenderer();
    const allocator = new MeshAllocator(renderer);
    allocator.allocateVertex(asHandle(1), positionLayout, new Float32Array(9));
    expect(() => allocator.allocateVertex(asHandle(1), positionLayout, new Float32Array(9))).toThrow();
  });

  it('freeing the last allocation in a slab destroys the slab', () => {
    const renderer = makeFakeRenderer();
    const allocator = new MeshAllocator(renderer, new MeshAllocatorSettings({ minSlabSize: 4096 }));
    allocator.allocateVertex(asHandle(1), positionLayout, new Float32Array(9));
    const slabBuffer = renderer.buffers[0]!;
    allocator.freeVertex(asHandle(1));
    expect(slabBuffer.destroyed).toBe(true);
    expect(allocator.vertexSlabCount).toBe(0);
  });
});

describe('MeshAllocator index allocation', () => {
  it('packs u16 and u32 indices into disjoint slabs', () => {
    const renderer = makeFakeRenderer();
    const allocator = new MeshAllocator(renderer, new MeshAllocatorSettings({ minSlabSize: 4096 }));
    allocator.allocateIndex(asHandle(1), 'uint16', new Uint16Array([0, 1, 2]));
    allocator.allocateIndex(asHandle(2), 'uint32', new Uint32Array([0, 1, 2]));
    expect(allocator.indexSlabCount).toBe(2);
  });

  it('returns slice with the right offset and baseVertex for indices', () => {
    const renderer = makeFakeRenderer();
    const allocator = new MeshAllocator(renderer, new MeshAllocatorSettings({ minSlabSize: 4096 }));
    allocator.allocateIndex(asHandle(1), 'uint32', new Uint32Array([0, 1, 2])); // 12 bytes
    allocator.allocateIndex(asHandle(2), 'uint32', new Uint32Array([3, 4, 5])); // 12 bytes
    const s2 = allocator.indexSlice(asHandle(2))!;
    expect(s2.offset).toBe(12);
    expect(s2.baseVertex).toBe(3); // offset / stride (4)
  });

  it('index allocations also bypass slabs when ≥ largeThreshold', () => {
    const renderer = makeFakeRenderer();
    const allocator = new MeshAllocator(
      renderer,
      new MeshAllocatorSettings({ minSlabSize: 1024, largeThreshold: 64 }),
    );
    allocator.allocateIndex(asHandle(1), 'uint32', new Uint32Array(16)); // 64 bytes
    expect(allocator.indexSlabCount).toBe(0);
    expect(allocator.largeAllocationCount).toBe(1);
  });

  it('index allocations pack even on baseVertex = false backends', () => {
    const renderer = makeFakeRenderer({ baseVertex: false });
    const allocator = new MeshAllocator(renderer, new MeshAllocatorSettings({ minSlabSize: 4096 }));
    allocator.allocateIndex(asHandle(1), 'uint32', new Uint32Array(3));
    allocator.allocateIndex(asHandle(2), 'uint32', new Uint32Array(3));
    expect(allocator.indexSlabCount).toBe(1);
    expect(allocator.largeAllocationCount).toBe(0);
  });
});

describe('MeshAllocator free-list coalescing', () => {
  it('frees adjacent ranges into one contiguous free range', () => {
    const renderer = makeFakeRenderer();
    const allocator = new MeshAllocator(renderer, new MeshAllocatorSettings({ minSlabSize: 4096 }));
    allocator.allocateVertex(asHandle(1), positionLayout, new Float32Array(9)); // 36 bytes
    allocator.allocateVertex(asHandle(2), positionLayout, new Float32Array(9)); // 36 bytes
    allocator.allocateVertex(asHandle(3), positionLayout, new Float32Array(9)); // 36 bytes
    allocator.freeVertex(asHandle(1));
    allocator.freeVertex(asHandle(2));
    // Now the free list should have one 72-byte range starting at 0; a 60-byte
    // allocation must fit there (not at the end of the slab).
    allocator.allocateVertex(asHandle(4), positionLayout, new Float32Array(15)); // 60 bytes
    const slice = allocator.vertexSlice(asHandle(4))!;
    expect(slice.offset).toBe(0); // coalesced free-list reused
  });
});
