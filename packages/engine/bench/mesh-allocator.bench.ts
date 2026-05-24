// MeshAllocator hot paths (Renderer Phase 6 / ADR-0025):
//
// - Steady-state allocate/free churn — every loaded scene's mesh swap-out
//   path. Walks the per-layout slab list, takes a first-fit range, frees it
//   later. Cost grows with slab fragmentation; this bench keeps the slab
//   mostly empty (allocate N, free N each iteration) so we measure the
//   walk + coalesce path, not GC effects.
// - Grow under pressure — slab spawn + growth cap behaviour. Allocates
//   until a slab fills, forcing a new slab `growthFactor`× larger; measures
//   per-allocation latency across the transition.
// - Large-threshold burst — allocations above `largeThreshold` bypass slabs
//   and route to dedicated buffers. The cost is one `createBuffer` per
//   allocation; this bench measures that path under churn.
//
// See docs/adr/ADR-0017 (bench schema) and docs/adr/ADR-0025 (mesh allocator).

import { bench, summary } from 'mitata';

import type { Buffer, BufferDescriptor, Renderer, RendererCapabilities } from '@retro-engine/renderer-core';

import {
  interMeshVertexBufferLayout,
  MeshAllocator,
  MeshAllocatorSettings,
  type MeshHandle,
  MeshAttribute,
} from '../src/mesh';

const asHandle = (n: number): MeshHandle => n as MeshHandle;

const makeBenchRenderer = (): Renderer => {
  const capabilities: RendererCapabilities = {
    computeShaders: false,
    storageTextures: false,
    timestampQueries: false,
    indirectDraw: false,
    bgra8UnormStorage: false,
    baseVertex: true,
  };
  const inertBuffer = (descriptor: BufferDescriptor): Buffer => ({
    size: descriptor.size,
    usage: descriptor.usage,
    destroy: () => undefined,
  });
  return {
    capabilities,
    createBuffer: inertBuffer,
    writeBuffer: () => undefined,
    init: () => Promise.resolve(),
    destroy: () => undefined,
    getPreferredSurfaceFormat: () => 'rgba8unorm',
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
  } as unknown as Renderer;
};

const positionLayout = interMeshVertexBufferLayout([MeshAttribute.POSITION]);

const smallVertices = new Float32Array(64 * 3); // 64 verts × 12 B = 768 B per mesh

summary(() => {
  bench('MeshAllocator: allocate + free churn (64 small meshes)', () => {
    const renderer = makeBenchRenderer();
    const allocator = new MeshAllocator(renderer, new MeshAllocatorSettings({ minSlabSize: 64 * 1024 }));
    for (let i = 0; i < 64; i++) {
      allocator.allocateVertex(asHandle(i + 1), positionLayout, smallVertices);
    }
    for (let i = 0; i < 64; i++) {
      allocator.freeVertex(asHandle(i + 1));
    }
  });

  bench('MeshAllocator: grow under pressure (forced two-slab spawn)', () => {
    const renderer = makeBenchRenderer();
    // Force three slab spawns: each slab fits ~85 small meshes, allocate 256.
    const allocator = new MeshAllocator(
      renderer,
      new MeshAllocatorSettings({ minSlabSize: 64 * 1024, maxSlabSize: 64 * 1024, growthFactor: 1 }),
    );
    for (let i = 0; i < 256; i++) {
      allocator.allocateVertex(asHandle(i + 1), positionLayout, smallVertices);
    }
  });

  bench('MeshAllocator: large-threshold burst (10 dedicated buffers)', () => {
    const renderer = makeBenchRenderer();
    const allocator = new MeshAllocator(
      renderer,
      new MeshAllocatorSettings({ minSlabSize: 1024, largeThreshold: 256 }),
    );
    const bigVertices = new Float32Array(128); // 512 bytes ≥ threshold
    for (let i = 0; i < 10; i++) {
      allocator.allocateVertex(asHandle(i + 1), positionLayout, bigVertices);
    }
    for (let i = 0; i < 10; i++) {
      allocator.freeVertex(asHandle(i + 1));
    }
  });
});
