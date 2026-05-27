# 3D clustered forward+ shading

- **Created:** 2026-05-27

## Context

Roadmap §10.2 + the `assign_objects_to_clusters` half of §10.3. ADR-0044 shipped 3D analytic lights with **simple forward** shading: the `pbr.wgsl` fragment loops over every light packed into the `GpuLights` uniform — `O(fragments × total_lights)`. Every fragment evaluates every light in the scene regardless of whether the light reaches it.

Clustered forward+ replaces that with a view-frustum froxel grid: lights are binned into clusters, and each fragment iterates only the lights touching its cluster — roughly `O(fragments × lights_per_cluster)`, near-constant as total scene light count grows. This is the correct fix for scenes with many simultaneous lights at high resolution, and it's how Bevy's renderer shades.

The light components, the `GpuLights` data, the BRDF, and the `prepare_lights` system from ADR-0044 are reused unchanged — clustering only changes *which* subset of lights a fragment evaluates, so this layers on top of the foundation without reworking it.

## Why deferred

Not a capability question — purely sequencing + an architectural commitment that deserves its own focused ADR:

- **Storage-buffer dependency.** Per-cluster variable-length light-index lists want a storage buffer (SSBO). SSBOs have **no WebGL2 path**, and there is no `RendererCapabilities.storageBuffers` flag yet. Landing clustering means adding that flag, a clean WebGL2-refusal path, and keeping ADR-0044's simple-forward loop as the WebGL2 fallback (capability-gated: simple forward on GL2, clustered on WebGPU). This answers the roadmap's standing open question ("which engine features are willing to be GL2-incompatible") for lighting and shouldn't be rushed.
- **Two shading paths.** `pbr.wgsl` would specialize into clustered and non-clustered variants, a real maintenance surface that wants deliberate design.
- **Compute vs CPU binning fork (open decision):**
  - *CPU-binned* — bin lights into froxels on the CPU each frame, upload the index lists as a storage buffer. No new HAL beyond the `storageBuffers` flag. Per-frame CPU binning cost is `O(lights × clusters_touched)`.
  - *Compute-binned* — bin on the GPU via a compute shader. Most scalable, but the **compute pipeline HAL does not exist** (only a stub `ComputePipeline` interface in `renderer-core`; no `ComputePipelineDescriptor` / `beginComputePass` / `ComputePassEncoder` / `createComputePipeline`). Building it belongs with Phase 13 (GPU-driven batching/culling), which already gates on `computeShaders`. Fully WebGL2-incompatible.
- Shadow maps (10.4) are the higher-visibility next step and are independent of clustering; ADR-0045+ proceed first.

## Acceptance

- A new ADR seals the clustered-forward+ design (`ClusterConfig` froxel grid, the binning system, the storage-buffer cluster→light-index layout, the `RendererCapabilities.storageBuffers` flag + WebGL2 refusal, and the pbr.wgsl clustered/simple-forward specialization).
- Many-light scenes shade through the clustered path on WebGPU and fall back cleanly to simple forward where storage buffers are unavailable, verified in `apps/playground`.
- The CPU-vs-compute binning fork is decided in that ADR (compute binning may itself defer to the Phase 13 compute HAL).
