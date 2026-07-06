# ADR-0155: World-space 3D text renders through the Core3d transparent phase

- **Status:** Accepted
- **Date:** 2026-07-06

## Context

ADR-0149 shipped MSDF text and the 2D path: `Text2d` entities are laid out into
glyph quads, packed into a shared instance buffer, and queued as `PhaseItem2d`s
into `ViewPhases2d`'s transparent phase, drawn once per **2D** camera with that
camera's `view_proj` bound. The vertex shader composes each glyph corner as
`center + quad_uv.x * basisX + quad_uv.y * basisY` where `center`/`basisX`/
`basisY` are **2D** (xy) values baked on the CPU from the entity's
`GlobalTransform` 2×2 affine + translation, and forces `z = 0`
(`view_proj * vec4(pos.xy, 0, 1)`).

What's missing (the Text P0 item's last acceptance criterion) is a **`Text`**
component that lives in the 3D world: positioned/oriented by a 3D
`GlobalTransform`, drawn through a **3D** (perspective) camera, and **depth-tested**
against the 3D scene so a label behind geometry is occluded.

Two structural questions: (1) which draw path — the in-scene 3D transparent phase
(`ViewPhases3d`) or a bespoke top-level pass node (as the UI overlay / gizmos /
grid do)? (2) orientation — oriented on the entity's plane, or camera-facing
(billboard)?

## Decision

**Reuse `ViewPhases3d`'s transparent phase**, mirroring the 2D text path one-for-one.
`Text` (3D) gets its own component + prepare + queue; the queue pushes one
`PhaseItem3d` per entity into `ViewPhases3d.transparent`, drawn by the existing
Core3d `TransparentPass3d` node — which already opens the pass with the camera's
color + **depth** attachment and binds the 3D view uniform at `@group(0)`. No new
render-graph node, no bespoke view/depth wiring (unlike the UI overlay pass of
ADR-0154, which is deliberately camera-less/screen-space — the opposite need here).

- **Oriented, not billboard, for the first slice.** Glyph quads are placed on the
  entity's local plane in 3D via the full `GlobalTransform` matrix: `basisX = width
  · col0`, `basisY = −height · col1`, `center = translation + localX·col0 +
  localY·col1`, using the world matrix's column 0 / column 1 / translation (the 2D
  packer's math, extended from 2 to 3 components). A **billboard** mode (basis from
  the camera's right/up) is a follow-up flag on the component, not a separate path.
- **Depth-test, no depth-write.** Text is alpha-blended; it tests against the
  scene depth (so it's occluded by nearer opaque geometry) but does not write depth
  (so overlapping glyphs within a string blend correctly), matching the gizmo/grid
  overlays. The pipeline is specialized by the camera's depth format (from `view.depth`)
  in addition to color format / hdr, since a 3D pass always has a depth attachment
  where the 2D pass has none.
- **New 68-byte instance layout** (`packGlyphInstance3d`): `center.xyz` + `basisX.xyz`
  + `basisY.xyz` + uv rect + `unitRange` + packed tint. The 2D packer's 52-byte
  layout can't hold 3D basis vectors, so 3D text uses its own instance buffer +
  pipeline; the MSDF fragment shader (median-of-RGB, screen-px-range AA) is shared
  verbatim.

The fragment path, font assets, layout (`layoutText`), and atlas bind-group cache
are all reused from the 2D path; only the vertex transform (2D→3D) and the pass
target (Core2d→Core3d, +depth) differ.

## Consequences

- A game shows crisp, depth-correct world-space labels/signs by spawning a `Text`
  with a 3D `Transform` under a 3D camera — no per-glyph objects, one instanced draw
  per entity, sorted with other transparents by view-space depth.
- Billboard, per-run rich text, and screen-space-size ("constant pixel size")
  modes are deferred follow-ups; the component reserves room for a `billboard` flag.
- Two text instance layouts/pipelines (2D 52-byte, 3D 68-byte) now coexist. This is
  the honest cost of 3D basis vectors; the shared layout/atlas/fragment code keeps
  the duplication to the vertex-transform seam.

## Implementation

Phased under `packages/engine/src/text/` (see roadmap/text-rendering.md Phase 3):

- **3a (this slice):** `packGlyphInstance3d` + `TEXT3D_INSTANCE_*` constants
  (`text-glyph-instance-3d.ts`) — the pure CPU packer transforming a laid-out glyph
  + a world matrix into a 3D quad instance. Unit-tested.
- **3b (next):** `Text` component (reflection-registered) + `text-3d.wgsl` +
  `Text3dPipeline` (depth-specialized) + `prepareText3d`/`queueText3d` (into
  `ViewPhases3d.transparent`) + `TextPlugin` wiring; browser-verified via a 3D
  camera + a `Text` occluded by a mesh in the sample export.

Key public symbols (3a): `packGlyphInstance3d`, `TEXT3D_INSTANCE_BYTE_SIZE`,
`TEXT3D_INSTANCE_FLOAT_COUNT`.
