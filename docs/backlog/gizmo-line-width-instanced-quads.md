# Gizmo line width via instanced quads

- **Created:** 2026-06-14

## Context

The gizmo / debug-draw foundation (ADR-0075) renders lines as 1px hardware `line-list` primitives. WebGPU (and wgpu) fix line primitives at 1px and cannot widen them, so thicker or anti-aliased gizmo lines are not possible with the current pipeline. This is the same starting point Bevy shipped before its gizmo line-width work.

The upgrade is the approach Bevy adopted (PR #8427, derived from `bevy_polyline`): render each segment as instance data `(positionA, positionB, colorA, colorB)` and expand it in the vertex shader into a screen-space-width quad (6 verts/instance), using the view uniform's viewport size for the pixel→clip width conversion. A `line_width` (and optional perspective-width) uniform controls thickness.

## Why deferred

A real trade-off, not a capability gap: the 1px path exercises the entire foundation the feature needed (per-frame buffer → upload → dedicated pass → per-view render-layer gating → depth-tested vs always-on-top variants) without coupling the first slice to width handling. Widening is a contained, additive change.

## Scope when picked up

- Change the gizmo vertex layout from per-vertex `(pos, color)` to per-segment instance `(a, b, colorA, colorB)`; emit 6 verts/instance.
- Expand the segment to a quad in `gizmo.wgsl` using the view viewport size; add a `line_width` (+ optional perspective) uniform.
- Add miter/round joins only if polyline shapes (circles, arcs, grids) show visible gaps at width.

The CPU-side segment buffer, the `GizmoPlugin`, the pass node, and the render-layer gate are unchanged — only the pipeline, vertex layout, and WGSL change.
