# A mesh missing a shader-required vertex attribute freezes the whole renderer

## Symptom

Spawning a glTF/mesh whose vertex data omits `TEXCOORD_0` (UV) — or any attribute the active
material's vertex shader declares — freezes the **entire** viewport: the frame loop keeps running
(timestamps advance, ImGui stays responsive) but nothing re-renders. Removing the offending entity
restores rendering.

## Root cause

The PBR vertex shader (`pbr.wgsl`) declares `@location(2) uv: vec2<f32>` unconditionally. A mesh
without UV produces a vertex-buffer layout with only locations 0 (POSITION) and 1 (NORMAL), so
`createRenderPipeline` fails validation:

```
vertex descriptor creation failed !matchesFormat(attribute(2), format(Float2), size(8), ...)
```

`createRenderPipeline` returns an **invalid** pipeline (the error is async, surfaced via an error
scope, not a JS throw). The draw then calls `setPipeline(invalidPipeline)`, which poisons the
command encoder; every later command reports "encoder state is not valid", `finish()` yields an
invalid command buffer, and `submit()` is a no-op — so the whole frame is discarded. This repeats
every frame → permanent freeze.

This is **not** morph-specific (it surfaced while testing morph targets with a hand-authored UV-less
cube, but the rigid pipeline fails identically). Any imported mesh lacking a shader-required
attribute triggers it.

## Severity

A single malformed asset takes down all rendering with no surfaced error — a sharp edge for anyone
importing real-world glTF that happens to omit UVs.

## Possible fixes (not yet chosen)

- Synthesize a zero UV attribute when a mesh lacks `TEXCOORD_0` (cheap, unblocks the common case).
- Make `uv` a gated shader input (only when the layout provides it) — larger, touches specialization.
- Skip the draw (and warn) when a mesh is missing a required attribute, instead of letting the
  invalid pipeline reach `setPipeline` — contains the blast radius to one entity.
