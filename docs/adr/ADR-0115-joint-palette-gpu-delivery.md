# ADR-0115: Joint-palette GPU delivery

- **Status:** Accepted
- **Date:** 2026-06-25

## Context

GPU skinning ([ADR-0114](ADR-0114-gpu-skinning-data-model-and-render-path.md)) computes a per-entity
joint palette each frame: an array of `mat4x4<f32>` the skinned vertex shader blends per vertex. How
that array reaches the shader is the one hard renderer decision, and it must stay WebGL2-reachable
(CLAUDE.md §5.4 / §10): WebGL2 has no storage buffers at all.

Three delivery shapes exist. A **uniform array** of joint matrices is universally available but capped
low — the practical ceiling is ~13–29 joints on common hardware (the uniform-vector budget shared with
view/material data), too few for real characters. A **storage buffer** holds an unbounded matrix array
indexed freely in the shader, but only where storage buffers are supported. A **data ("bone") texture**
fakes random-access storage on WebGL2 via `texelFetch` (4 texels per matrix), the standard fallback
where storage buffers are absent.

The skinned mesh also needs its palette without exploding the bind-group budget. WebGPU's default
`maxBindGroups` is 4; a lit skinned mesh already needs view(0), material(1), and lights(2). A per-entity
palette bind group would not fit alongside, and a per-entity group also blocks instancing.

## Decision

- **WebGPU delivers the palette through one shared storage buffer.** Every skinned entity's palette is
  concatenated into a single `array<mat4x4<f32>>` storage buffer, uploaded once per frame. Each instance
  carries a `joint_offset: u32` base index (in matrix units) as per-instance vertex data; the shader
  reads `joints[joint_offset + jointIndex]`. The buffer binds **once per frame** as a frame-global bind
  group, not per entity — so skinned meshes still batch and instance, and the bind-group budget is not
  multiplied per draw. This matches Bevy's storage-buffer skinning path.

- **The palette bind group is group(3).** view(0) / material(1) / lights(2) / palette(3) fills the
  4-group budget exactly. The skinned draw closure binds group(3) to the shared palette group; the
  skinned pipeline layout declares it as a read-only storage buffer visible to the vertex stage. SSAO,
  which also uses group(3), is therefore mutually exclusive with skinning on a given view in Phase 0;
  the skinned closure restores a view's AO group after drawing so a mixed scene degrades (AO keeps
  working on rigid meshes) instead of hitting a validation error.

- **A `RendererCapabilities.storageBuffers` flag gates the path, from day 1.** `true` on WebGPU, `false`
  on WebGL2. Skinning checks the flag before taking the storage-buffer path. The WebGL2 **bone-texture**
  fallback is the gated alternative; its delivery code lands with the WebGL2 backend (a stub today, so
  there is nothing to drive or test against now). The flag is the seam: it selects the TypeScript-side
  delivery (create/bind a storage buffer vs. a data texture). It is independent of shader translation —
  a WGSL→GLSL transpiler converts the shader *language*, but cannot conjure a storage-buffer binding
  WebGL2 does not have, so the data path still forks on this flag.

- **No uniform-array path in Phase 0.** The small-skeleton uniform optimization is deliberately skipped:
  it adds a third delivery path and a per-skeleton threshold for a case the storage buffer already
  covers on WebGPU. It can be added later behind the same flag if a no-storage-buffer target needs a
  lighter path than the bone texture.

## Consequences

- Skinned draws upload one contiguous buffer per frame and add a single `joint_offset` per instance —
  cheap, and instancing across skinned entities is preserved.
- The palette size grows with `Σ jointCount` over skinned entities; the shared buffer grows to fit.
- Skinning is unavailable on WebGL2 until the bone-texture path is implemented, but it is *gated*, not
  *leaked*: no storage-buffer assumption reaches code that runs on a WebGL2 device.
- Skinning and SSAO compete for group(3); supporting both on one view needs a later bind-group rework
  (e.g. folding the palette into the view group, which would touch every pipeline's group(0)).
- Skinned meshes skip the prepass in Phase 0 (the prepass motion-vector buffer reuses vertex locations
  4–7, which collide with the skinned weights at location 4).

## Implementation

- `packages/renderer-core/src/capabilities.ts` — `RendererCapabilities.storageBuffers`
- `packages/renderer-webgpu/src/index.ts` — reports `storageBuffers: true`
- `packages/renderer-webgl2/src/index.ts` — reports `storageBuffers: false`
- `packages/engine/src/skinning/skinned-palette-gpu.ts` — `SkinnedPaletteGpu` (shared buffer, group(3) layout + bind group, per-entity offsets)
- `packages/engine/src/skinning/skinned-instance-layout.ts` — `joint_offset` instance attribute
- `packages/engine/src/material/pbr.wgsl.ts` — `@group(3)` palette binding under `#ifdef SKINNED`
- `packages/engine/src/material/material-plugin.ts` — skinned pipeline layout (group(3) = palette), skinned draw closure
