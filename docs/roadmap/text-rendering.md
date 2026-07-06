# Engine Text Rendering (MSDF)

- **Created:** 2026-07-06
- **Status:** In progress (Phase 1 shipped 2026-07-06)
- **ADR:** [ADR-0149](../adr/ADR-0149-engine-text-msdf.md)

## Goal

Crisp game-facing text at any scale/rotation via MSDF, in `packages/engine/src/text/`.
Font atlases are generated offline (`msdf-atlas-gen`) and loaded as assets; the
runtime shapes text (layout) and batches glyph quads through the 2D pipeline with
an MSDF shader. Required by the in-game UI system.

## Phases

### Phase 1 — Font data + layout engine (pure) ✅ (2026-07-06)

- `FontMetrics` / `GlyphMetrics` / `MsdfFont`; `parseMsdfFont` (msdf-atlas-gen JSON).
- `layoutText` (positioned glyph quads: advance, `\n`, word-wrap at max width,
  horizontal alignment, line height) + `measureText` (bounds, for the UI measure
  callback). Fully unit-tested, no GPU.

### Phase 2 — Rendering

**Phase 2a — Font asset + component (data/asset side) ✅ (2026-07-06)**

- `Font` asset (parsed `MsdfFont` + atlas `Handle<Image>`) + `Fonts` store.
- `createFontImporter` — parses a `.font` descriptor (msdf-atlas-gen JSON),
  decodes the companion atlas into a **linear** image sub-asset (sibling
  `<base>.png` by default, or a top-level `"image"` override).
- `Text2d` component (text, font, size, tint, align, lineHeight, maxWidth,
  letterSpacing, pivot), reflection-registered (round-trips through a scene).
- `TextPlugin` (Fonts store + `.font` asset kind + loader + Text2d schema).
  Not yet in the default plugin set — wired when the render path lands.
- Unit-tested: importer (fake decoder/ctx), Text2d defaults + scene round-trip.

**Phase 2b — Glyph render pipeline ✅ (2026-07-06)**

- `retro_engine::text` MSDF WGSL shader (median-of-RGB, screen-px-range AA).
- `TextPipeline` (specialized on render-target shape, always alpha-blended),
  `TextInstanceBuffer`, `TextPreparedBatches`, `packGlyphInstance` (world-space
  quad + per-glyph UV + `unitRange`).
- `text-prepare` (after `image-prepare`) + `text-queue` systems: lay out visible
  text, pack glyph quads in one upload, queue one transparent instanced draw per
  entity. Bench: `text-prepare.bench.ts` (layout + pack, ~65µs / 400 glyphs).
- Verified end-to-end via the capturing renderer (transparent-pass draws,
  per-entity batching, instance counts, atlas bind group).

**Phase 2c — Built-in default font + sample ✅ (2026-07-06)**

- No native `msdf-atlas-gen` and no headless rasterizer available → shipped a
  **pure-JS SDF font generator** (`generateSdfFont`) + a **built-in default font**
  (`generateDefaultFontAtlas` / `installDefaultFont`): monoline stroke glyphs
  (uppercase, digits, punctuation; lowercase aliased) rasterized to a
  single-channel SDF atlas the median-of-RGB shader consumes unchanged. Crisp,
  scalable, zero external deps or committed binaries. Unit-tested (SDF gradient,
  metrics, atlas) + capturing-renderer draw test.
- Playground `?mode=text` draws title / multi-line / wrapped / right-aligned HUD
  / spinning `Text2d` using the built-in font.
- Studio wiring: 2D render plugins are project-declared (like `SpritePlugin`), so
  a project using text adds `TextPlugin` — no studio-host change needed.
- **Pending only:** on-screen visual confirmation (studio MCP is down this
  session; open playground `?mode=text` or a studio project with `TextPlugin`).
  A true multi-channel MSDF atlas via `msdf-atlas-gen` remains a tooling upgrade
  (the `.font` importer already loads one) — the built-in SDF font is the default.

### Phase 3 — Depth

- ✅ **`measureText` wired into the in-game UI layout measure callback**
  (2026-07-06): `@retro-engine/ui`'s `UiText` component + `makeTextMeasure`
  build a `MeasureFunc` from `Font.measure`, attached to leaf text nodes by
  `UiPlugin` so flexbox sizes a node to its text (wrapping to the offered
  width). Headless — 53 UI tests.
- 🟡 **World-space `Text` (3D) — promoted (ADR-0155), phased:**
  - ✅ **Phase 3a (2026-07-06):** `packGlyphInstance3d` + `TEXT3D_INSTANCE_*`
    (`text-glyph-instance-3d.ts`) — the CPU packer that transforms a laid-out glyph
    + a 3D `GlobalTransform` world matrix into a 68-byte world-space quad instance
    (`center.xyz` + `basisX.xyz` + `basisY.xyz` + uv + unitRange + tint). Unit-tested
    (identity / z-translation / Y-rotation prove the third dimension).
  - ✅ **Phase 3b — render path (2026-07-06):** the `Text` component
    (reflection-registered), `text-3d.wgsl` (3D `view_proj`, shared MSDF fragment),
    a depth-specialized `Text3dPipeline` (`depthWriteEnabled:false`,
    `depthCompare:'less-equal'`, keyed on the camera depth format), a
    `Text3dInstanceBuffer` + `Text3dPreparedBatches`, and `prepareText3d`/
    `queueText3d` queuing one `PhaseItem3d` per entity into
    `ViewPhases3d.transparent` (drawn depth-tested by the Core3d `TransparentPass3d`
    node). Wired into `TextPlugin`. **Integration-verified** via a capturing-renderer
    test (`text3d-plugin.test.ts`): a `Text` under a `Camera3d` emits one instanced
    draw into the `.transparent3d` pass (2 glyphs → instanceCount 2), atlas bound at
    `@group(1)`; no-font skipped. Bench: `text-prepare-3d`.
  - **Remaining (3c, optional):** browser **pixel** confirmation (a 3D scene showing
    a `Text` occluded by a mesh) + a `billboard` flag; rich-text runs / RTL/bidi later.

### On-screen confirmation (✅ 2026-07-06)

The Phase 2c pending item — real on-screen confirmation — is satisfied: the
`@retro-engine/sample-game` web export (built-in default font) **renders crisp
MSDF text in a real browser**, verified via Playwright (see
[web-build-target.md](web-build-target.md)). The built-in SDF default font is the
default path; a true multi-channel MSDF atlas via `msdf-atlas-gen` remains an
optional tooling upgrade (the `.font` importer already loads one).

## Open questions (resolved / remaining)

- **Package vs engine?** → in `packages/engine/src/text/` (deep 2D-pipeline
  coupling), per ADR-0149.
- **Runtime atlas generation?** → out of scope; atlases are offline-baked and
  shipped. Dynamic/CJK glyph sets revisited when a consumer needs it.
- **Bitmap fallback?** → MSDF only for now (one scalable path).

## Links

- [ADR-0149](../adr/ADR-0149-engine-text-msdf.md)
- Chlumsky `msdf-atlas-gen` / `msdfgen`; awesome-msdf shader reference
