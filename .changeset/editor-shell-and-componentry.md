---
'@retro-engine/editor-sdk': minor
'@retro-engine/renderer-webgpu': patch
---

feat(editor-sdk): editor shell framework + component library + drawn icons (ADR-0073)

Builds the registry-driven editor shell and the design-system component library on top of the normalized `ui` surface from ADR-0072, plus a procedural icon set.

**Editor shell** (`createEditor`): a composition-only `Editor` that owns the menu bar, a pinned toolbar/status rail, a dockspace host, and the per-frame panel draw. Panels register by a path-like id — `editor.addPanel({ id: '/inspector', slot: 'right', render })` — so a new dockable window needs no shell change; an auto-generated **Window** menu lists every panel's visibility toggle. `addMenu` / `setToolbar` / `setStatusBar` cover the chrome regions. `PanelContext` exposes only `ui` + `widgets`, keeping the shell engine-agnostic. The default dock layout is a generated `ini` (`buildDefaultLayout`, stable `DockNodeId` constants) bound to the host window, since the binding exposes no `DockBuilder`.

**Component library** (`widgets`): the design-system componentry composed on `ui` — button variants, `iconButton`, `Switch`, `Badge`, `dragNumber` (axis chips), `vec3`, sliders, `inputNumber`, `combo`, `radioGroup`, `listBox`, `colorField`, `inspectorRow`, `collapsingHeader`, `treeItem`, `dataTable`, `assetCard`/`assetGroup` (+ `ASSET_TYPES`), context menus, and a centered modal `dialog`. Edit widgets take a value and return the next.

**Icons**: `drawIcon` renders the editor's Lucide-named icon vocabulary procedurally with draw-list primitives — asset-free and immune to the binding's font-rasterizer and `AddText` defects. The Lucide name→codepoint map (`iconGlyph`, `LUCIDE_CODEPOINTS`) and font-merge support ship for a future binding that can rasterize an icon font.

**Surface additions**: the `Ui` surface gains child regions, groups, text/number/color inputs, layout cursors, `icon`, and popups; `FontSpec` gains `merge`/`glyphRanges`; `RetroPalette` gains `red400`, `magenta400`, and `textMuted` so axis/danger/play-mode/label colors come from the theme. `Draw` gains a draw-list facade with the logo cube and a native-text fallback.

**renderer-webgpu**: `createImGuiOverlay(renderer, { fontLoader })` selects the truetype (default) or freetype glyph backend.
