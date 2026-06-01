# Backlog: AO correctness for sub-viewports and orthographic cameras

## Why

ADR-0054's AO pass made two simplifying assumptions that hold for the common
case (a full-target perspective camera) but are approximate otherwise:

- **Sub-viewports.** The AO target and depth texture are full-target sized, and
  reconstruction maps `texel / targetSize → NDC`. The jitter offset, however, is
  converted to NDC against `viewport.physicalSize` (matching how the camera
  bakes jitter). When a camera renders to a sub-rect (`Camera.viewport` smaller
  than the target), the texel↔NDC mapping the AO pass uses no longer matches the
  rasterized geometry, so reconstruction drifts within the viewport.

- **Orthographic cameras.** The screen-space sample radius is derived from the
  perspective y focal length (`projection[1][1]`) and `1 / -viewZ`. For an
  orthographic projection the view-space radius maps to a constant pixel radius
  independent of depth, so the current formula over/under-samples.

Both produce wrong-but-not-crashing AO; neither is exercised by the default
playground harness (full-target perspective).

## Scope

- Sub-viewport: thread the camera's viewport rect into the AO params and map
  texel → viewport-relative NDC (or size the AO target to the viewport).
- Orthographic: branch the screen-radius computation on projection kind (a flag
  or `projection[3][3]` test) — constant pixel radius for ortho.
- Add a reconstruction/round-trip test covering a sub-viewport and an
  orthographic projection.

## Done definition

AO reconstructs and samples correctly for a camera with a non-full-target
viewport and for an orthographic camera, verified in `apps/playground`
(`?mode=ao`) and by a unit test. Deferred — the full-target perspective path is
the shipping default; this generalizes it.
