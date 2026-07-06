---
'@retro-engine/engine': minor
---

feat(engine): world-space 3D text — glyph packer (ADR-0155, phase 3a)

First slice of world-space `Text` (the Text P0 item's last acceptance criterion):
`packGlyphInstance3d` + `TEXT3D_INSTANCE_BYTE_SIZE` / `TEXT3D_INSTANCE_FLOAT_COUNT`
(`text/text-glyph-instance-3d.ts`). The packer transforms a laid-out glyph + a 3D
`GlobalTransform` world matrix into a 68-byte world-space quad instance
(`center.xyz` + `basisX.xyz` + `basisY.xyz` + uv rect + `unitRange` + packed tint)
— the 2D packer's math extended from 2 to 3 components, so text orients on the
entity's plane in 3D.

Unit-tested (identity / z-translation / Y-rotation cases prove the third
dimension). Additive and not yet wired into a render pass; ADR-0155 records the
phase-3b plan (a `Text` component + depth-specialized pipeline drawn through the
Core3d `ViewPhases3d.transparent` phase).
