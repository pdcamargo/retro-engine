# ADR-0025: MeshAllocator — page-based slab suballocator over shared GPU buffers

- **Status:** Accepted
- **Date:** 2026-05-24

## Context

ADR-0024 ships the `Mesh` value class, the `RenderMesh` GPU representation, and the typed vertex-attribute slots. The decision deliberately keeps `RenderMesh` buffer-offset-free — the only way to find a mesh's GPU bytes is to query a separate allocator at draw time. This ADR is that allocator.

The motivation is Phase 13 (GPU-driven batching & culling), not Phase 6. Phase 13's auto-batching collapses many same-pipeline draws into one indirect draw against one shared buffer; for that to be possible *at all*, many meshes must already pack into one buffer. Routing every mesh's vertices through a per-mesh `createBuffer` from day 1 forecloses the path. Bevy hit this and built `MeshAllocator` for the same reason; we mirror the shape (with smaller defaults for browser-scale scenes).

The allocator's job is narrow: take per-mesh `(vertex bytes, index bytes)` plus the mesh's `MeshVertexBufferLayoutRef`, return `{ buffer, offset, size, baseVertex }` slices the draw site binds via `setVertexBuffer` / `setIndexBuffer` / `drawIndexed`. The allocator owns the lifetime of the GPU buffers; consumers own the lifetime of the handles.

Three concrete constraints shape the design:

- **Vertex layout determines slab eligibility.** Two meshes with different per-vertex strides cannot pack into the same buffer — the vertex-buffer layout `arrayStride` fixes the byte spacing. The allocator must bucket per layout.
- **`baseVertex` is WebGPU-only.** `drawIndexed`'s `baseVertex` parameter lets one slab-shared index range point at a slot-relative vertex slice without rewriting indices. WebGL2's `drawElements` has no such parameter; on that backend, every mesh must own its vertex buffer. The capability is gated through `RendererCapabilities.baseVertex` (ADR-0024).
- **Asset lifecycle drives allocation.** The `MeshPlugin` extract pipeline pulls `MeshAssetEvent::{Added, Modified, Removed}` (ADR-0024 §7); `Modified` means "the GPU representation is stale" — cheaper to free + re-allocate than to in-place-resize.

Out of scope for this ADR (each documented in §"Not yet done" with its trigger):

- **Slab compaction** — deferred until a measured fragmentation problem.
- **Best-fit / buddy allocator** — first-fit is plenty for v1; revisit when a worst-case scene shows pathological fragmentation.
- **Async upload pipeline** — `writeBuffer` is synchronous; matches the pattern ADR-0022 §6 established for the pipeline cache.
- **Cross-frame double-buffering / staging rings** — not justified by any current consumer.
- **GPU compaction shader** — Phase 13 territory.

## Decision

1. **`MeshAllocator` lives in `packages/engine/src/mesh/allocator.ts`.** Inserted by `MeshPlugin` as an App resource. Constructor takes the renderer + an optional `MeshAllocatorSettings` (also a resource — users insert one before `CorePlugin` runs to tune; the plugin honours an existing instance and falls back to defaults otherwise).

2. **`MeshAllocatorSettings` defaults are smaller than Bevy's:**
   - `minSlabSize` — 1 MiB (initial slab byte capacity).
   - `maxSlabSize` — 64 MiB (cap; new slab spawned past this).
   - `largeThreshold` — 16 MiB (allocations `≥ threshold` bypass slabs).
   - `growthFactor` — 1.5 (next slab in a list is `min(prev × 1.5, max)`).

   Picked smaller than Bevy's `1 / 512 / 256 MiB` because retro-engine targets browser-scale scenes (KB–MB total mesh data). Oversizing wastes VRAM for no benefit; users with bigger scenes insert their own `MeshAllocatorSettings`.

3. **Two slab registries: vertex (keyed per layout) and index (keyed per format).**
   - `vertexSlabs: Map<MeshVertexBufferLayoutRef, Slab[]>` — different layouts get disjoint slab lists; same layout shares.
   - `indexSlabs: Map<IndexFormat, Slab[]>` — `'uint16'` and `'uint32'` are disjoint (different per-index stride).

   `MeshVertexBufferLayoutRef` identity is the dedupe key. ADR-0024 §5 makes the ref hash-consed so `===` comparison is meaningful — two meshes producing structurally-identical attribute orders share a slab list automatically.

4. **Per-slab state: a `Buffer`, a `ranges` list (used), and a `free` list.** Both lists stay sorted by offset; `ranges` is non-overlapping (used regions, one per mesh handle); `free` is non-overlapping + coalesced (free regions). On `free`, the released `(offset, size)` returns to `free` and coalesces with the immediately-preceding and immediately-following free range if adjacent.

5. **First-fit allocation policy.** The slab walks `free` from low offset to high, taking the first range that fits. Best-fit was considered and rejected — it adds bookkeeping cost for a problem (fragmentation) we have not measured. The bench (`mesh-allocator.bench.ts`) covers churn so a regression to a degenerate fragmentation pattern is caught.

6. **Alignment is 4 bytes.** WebGPU's `COPY_BUFFER_ALIGNMENT`. Every allocation rounds size up to a multiple of 4. Vertex stride is the layout's `arrayStride`; index stride is 2 (u16) or 4 (u32).

7. **Large-threshold escape: dedicated buffer.** Allocations whose byte-size is `≥ settings.largeThreshold` short-circuit to `renderer.createBuffer({ size, ... })` — no slab walk, no shared buffer. The slice returned has `offset = 0`, `baseVertex = 0`. Mirrors Bevy's `slab_allocator` + `allocate_large` split.

8. **`baseVertex` capability gate.** When `renderer.capabilities.baseVertex === false`, *every* vertex allocation routes through the large-allocation path (per-mesh buffer) regardless of size. Index allocations still pack because uint16/uint32 base-index *is* supported on WebGL2's `drawElements`. The WebGL2 backend (Phase 14) flips the flag and the allocator does the right thing transparently.

9. **Slab growth + spawn policy.** When no existing slab in a layout's slab list has a fitting free range:
   - Compute `newSize = max(minSlabSize, prevSize × growthFactor, requestedSize)`.
   - Clamp to `maxSlabSize` (the request can still exceed `maxSlabSize` if a single mesh is enormous — at that point the large-threshold check has already routed it; the spawn path is reachable only for under-threshold requests).
   - Allocate a fresh `Buffer` of `newSize` bytes (4-aligned), append to the slab list, and carve the request out of it.

10. **Lifetime is per-handle, ref-counted at the allocation boundary.** `allocateVertex(handle, ...)` records `handle → Allocation`; `freeVertex(handle)` looks up the record, returns the range to the slab's free list, deletes the record. Same for indices in their own map. Double-allocate throws (caller bug); free on an unknown handle is a silent no-op (resilience for the extract `Modified` path).

11. **Empty slabs are destroyed.** When `freeVertex` / `freeIndex` removes the last range from a slab, the slab's `Buffer.destroy()` runs and the slab is removed from its layout's list. The next allocation against that layout spawns a fresh slab. Avoids holding GPU memory after a scene transition.

12. **`vertexSlice` / `indexSlice` return `{ buffer, offset, size, baseVertex }`.** The `baseVertex` field is the slot-relative vertex / index for slab allocations (= `offset / stride`), and `0` for large allocations (which own their buffer). Draw sites pass it as the `baseVertex` argument to `drawIndexed` — that's the per-mesh offset into the slab-shared vertex range without rewriting indices.

13. **`allocateVertex` / `allocateIndex` upload via `renderer.writeBuffer` synchronously.** No staging ring, no command-encoder-driven upload, no async. Matches ADR-0022 §6's trade-off — `writeBuffer` is the simplest correct primitive on WebGPU, and Phase 13's GPU-driven path will introduce its own upload pipeline anyway.

14. **No allocator compaction in v1.** A slab whose `ranges` list shrinks to one mesh holds the rest of its bytes as one big free range; if that mesh is freed, the whole slab disappears (per §11). Mid-lifetime compaction (moving live allocations to lower offsets to merge free ranges) is deferred until a real consumer measures fragmentation as a problem.

Composition-only. `MeshAllocator` is one concrete class — no interface, no base class, no inheritance. The Bevy `slab_allocator.rs` / `allocator.rs` split corresponds to the `allocateSlab` / `allocateLarge` private methods on the same class, not separate types.

## Consequences

**Easier:**

- Phase 13's auto-batching has a buffer it can share — meshes within the same `(layout, material)` bucket already pack into one vertex buffer + one index buffer; the batched draw becomes one `setVertexBuffer` + one `setIndexBuffer` + one `drawIndexed` with stride.
- The draw site is layout-agnostic: `pass.drawIndexed(rm.bufferInfo.indexCount, 1, idxSlice.baseVertex, vtxSlice.baseVertex, 0)` works whether the mesh was packed into a 1 MiB slab or got a dedicated 32 MiB buffer.
- The WebGL2 backend (Phase 14) plugs in without allocator changes — the capability flag flips and every vertex allocation gets its own buffer.
- Bench coverage is on the hot path that matters: steady-state churn (`16.6 µs` for 64 small meshes round-tripped per iteration), grow-under-pressure (`72 µs` for 256 allocations forcing slab spawns), and large-threshold bursts (`441 ns` for 10 dedicated buffers per iteration).
- The TS surface is small — `allocateVertex`, `allocateIndex`, `freeVertex`, `freeIndex`, `vertexSlice`, `indexSlice`, plus the three diagnostic getters. Phase 7 / 8 don't need to know about slabs.

**Harder / accepted trade-offs:**

- **First-fit policy can fragment under churn.** A workload that allocates many small meshes, frees every other one, then asks for a slightly-larger mesh will skip past the small holes and grow the slab unnecessarily. Best-fit is the textbook fix; we deferred it because the bench covers the case and best-fit's bookkeeping (a size-sorted free list) is plausible-but-unwarranted complexity. Trigger to revisit: a measured allocation-failure or pathological-growth scenario in real content.
- **Modified events trigger free + re-allocate, not in-place update.** A mesh whose POSITION buffer is the same size as before still gets freed and re-uploaded. The alternative — check the byte-length and skip the free — adds a branch and complicates the cache state; the freed range is immediately reusable so the cost is bounded.
- **`MeshVertexBufferLayoutRef` identity is global hash-cons.** Two consumers that conceptually want different layouts but produce structurally-identical attribute orders share an allocator slab. This is the right call for dedupe but it means a mesh consumer cannot opt out of slab-sharing by constructing a "different" layout that's structurally identical.
- **`writeBuffer` is synchronous.** A large mesh upload blocks the calling system. Phase 6 has no measured hitch; Phase 7's first big scene is the trigger for a staging ring / async upload primitive.
- **No slab compaction means a long-running App can accumulate fragmentation.** ADR-0022 §6 made the same trade-off for the pipeline cache. The fix is paired: the asset system's eviction story is the natural place to add compaction, because both need the same GPU-handle lifetime hooks.
- **Settings are global to the allocator.** A single `MeshAllocatorSettings` resource governs vertex slabs of every layout. A workload that mixes one giant per-frame-streamed mesh layout with many small persistent layouts gets the same slab policy for both. Per-layout overrides are a natural extension when a consumer asks; today the global setting is enough.
- **The allocator counts allocations, not bytes.** `largeAllocationCount` reports the number of dedicated buffers, not their total size. Detailed VRAM telemetry waits for Phase 15's stats overlay.

## Alternatives considered

- **Hash mesh content into the handle.** Content-addressed `MeshHandle` (id derived from a hash of the bytes) would deduplicate identical meshes across the registry — every `Cuboid().mesh().build()` call would share an allocator slot. Rejected because (a) the dedupe is rarely worth the hash cost; (b) it forecloses mutate-in-place ergonomics (`meshes.mutate(handle, ...)` would need to mint a new handle on every edit); (c) the asset system will provide deduplication at a higher layer (content-addressed assets), where it belongs.

- **Shared-slab regardless of layout.** Pack every mesh's bytes into one giant buffer; track per-mesh `(offset, stride)`. Rejected because `setVertexBuffer` cannot bind an offset *and* override the pipeline's stride — the stride lives on the pipeline's `VertexBufferLayout`. Mixing layouts in one buffer would require either a stride-aware draw command (which WebGPU doesn't have) or a separate pipeline per stride (defeating the purpose of sharing).

- **Best-fit free-list policy.** Less fragmentation than first-fit for some workloads. Rejected for v1 because the bench scenarios we measure pass at first-fit and best-fit's overhead is non-trivial; the trigger to revisit is a measured fragmentation problem.

## Not yet done

Each entry below is deferred until its trigger consumer lands.

- **Slab compaction (move live allocations to merge free ranges).** Waits for a measured fragmentation problem.
- **Best-fit free-list policy.** Same trigger.
- **Per-layout `MeshAllocatorSettings` overrides.** Waits for a consumer with a measurably-different layout-specific allocation pattern.
- **Async upload (staging ring + command-encoder-driven copies).** Waits for a measured first-frame hitch on a real scene.
- **Detailed VRAM telemetry (bytes per layout, fragmentation ratio).** Pairs naturally with Phase 15's render statistics overlay.
- **GPU-side compaction shader.** Phase 13.

## Implementation

- `packages/engine/src/mesh/allocator.ts` — `MeshAllocator`, `MeshAllocatorSettings`, `AllocatorSlice`. Constants: `COPY_BUFFER_ALIGNMENT = 4`.
- `packages/engine/src/mesh/mesh-plugin.ts` — `MeshPlugin.build` inserts `MeshAllocatorSettings` (default) and `MeshAllocator` (constructed against the renderer + settings); the Prepare system calls `allocateVertex` / `allocateIndex` / `freeVertex` / `freeIndex`.
- `packages/engine/src/mesh/allocator.test.ts` — full coverage of the slab share / split / grow / free / coalesce paths, large-threshold escape, and the `baseVertex` capability gate.
- `packages/engine/bench/mesh-allocator.bench.ts` — three hot-path scenarios per CLAUDE.md §11.
