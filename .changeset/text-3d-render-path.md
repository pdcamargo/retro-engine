---
'@retro-engine/engine': minor
---

feat(engine): world-space 3D text render path — `Text` component (ADR-0155, phase 3b)

Adds the render path for world-space `Text` (the Text P0 item's last acceptance
criterion), building on the 3a glyph packer.

- New `Text` component (reflection-registered; same authored fields as `Text2d`
  — string, font, size, color, align, lineHeight, maxWidth, letterSpacing,
  anchor). The entity's 3D `GlobalTransform` positions/orients the text on its
  local plane; it's drawn through a 3D camera and depth-tested against the scene.
- `text-3d.wgsl` (3D `view_proj`, shared MSDF fragment), a depth-specialized
  `Text3dPipeline` (`depthWriteEnabled: false`, `depthCompare: 'less-equal'`,
  keyed on the camera depth format), `Text3dInstanceBuffer` +
  `Text3dPreparedBatches`, and `prepareText3d`/`queueText3d` which queue one
  `PhaseItem3d` per entity into `ViewPhases3d.transparent` — drawn by the Core3d
  `TransparentPass3d` node (view + read-only depth already bound). Wired into
  `TextPlugin`.

Integration-verified (`text3d-plugin.test.ts`, capturing renderer): a `Text` under
a `Camera3d` emits one instanced draw into the `.transparent3d` pass (2 glyphs →
instanceCount 2), atlas bound at `@group(1)`; no-font text is skipped. Bench:
`text-prepare-3d`. Additive; the 2D `Text2d` path is untouched.
