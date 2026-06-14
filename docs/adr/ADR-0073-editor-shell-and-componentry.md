# ADR-0073: Editor shell framework + component library (registry-driven, drawn-icon)

- **Status:** Accepted
- **Date:** 2026-06-13

## Context

[ADR-0072](ADR-0072-imgui-editor-ui-layer.md) gave `editor-sdk` a normalized immediate-mode `ui` surface over Dear ImGui (jsimgui), theming, fonts, docking, and layout persistence — but no editor structure. The studio (and future `editor-*` consumers) need the full editor layout (menu bar, toolbar, dockable panels, status bar), a library of the design-system components (the inspector field family, tree rows, badges, switches, data tables, asset tiles, dialogs), and a way to **add new panels/windows without touching the shell** — the project requirement being a registration call keyed by a path-like id. A design handoff specified the layout, 28 components, and three reference screens (default / play mode / project settings) to match.

CLAUDE.md §5.2 reserves the editor-SDK surface for this: "Custom windows/dialogs register against an `EditorSDK` surface (lives in `packages/editor-sdk`)" with "No giant `EditorWindow` base class." Composition, not inheritance.

Two binding realities shaped the build. (1) `jsimgui@0.14.0` exposes no `DockBuilder`, so a programmatic default split layout is impossible — the layout must be seeded from a Dear ImGui `ini`. (2) jsimgui's font system renders many icon fonts (including Lucide) as `.notdef` even via the FreeType loader, and its draw-list `AddText` overloads are unusable (the bare one binds `text_end` as an empty `std::string` → zero-length range; the font-pointer one has an unbound clip-rect param). So neither a merged icon font nor draw-list glyph text is viable.

## Decision

1. **A registry-driven `Editor` shell, composition-only.** `createEditor()` returns an `Editor` with `addPanel`, `addMenu`, `setToolbar`, `setStatusBar`. A panel is a plain `PanelDef` registered by a **path-like id** (`addPanel({ id: '/inspector', slot: 'right', render })`); adding a panel needs no other change, and an auto-generated **Window menu** lists every panel's visibility toggle. The shell owns the menu bar, a pinned toolbar/status rail, the dockspace host, the per-frame panel draw, and the default layout. It stays engine-agnostic — panels close over their own data; `PanelContext` exposes only `ui` + `widgets`.

2. **The default dock layout is a generated `ini` plus per-window `SetNextWindowDockID`.** With no `DockBuilder`, `buildDefaultLayout()` emits a `[Docking][Data]` split tree with **constant node ids** ({@link DockNodeId}) and binds it to the host window via the `Window=` field (its id is ImGui's stable hash of `###re-dockhost`). The same constants seed `SetNextWindowDockID` so panels attach even though window labels carry dynamic count pills (via `###id` stable identity).

3. **A `widgets` component library** composes the design-system componentry on `ui`: buttons/variants, `iconButton`, `Switch`, `Badge`, `dragNumber` (axis chips), `vec3`, sliders, `inputNumber`, `combo`, `radioGroup`, `listBox`, `colorField`, `inspectorRow`, `collapsingHeader`, `treeItem`, `dataTable`, `assetCard`/`assetGroup`, context menus, and a centered modal `dialog`. Edit widgets take a value and return the next one.

4. **Icons are drawn procedurally, not from a font.** A `drawIcon(name, …)` vector set renders the editor's Lucide-named icon vocabulary with draw-list primitives — asset-free, crisp at any size, and immune to the binding's font-rasterizer and `AddText` defects. Draw-list text (tree labels, chips) routes through a native colored `Text` positioned absolutely (the binding's `AddText` cannot render). The Lucide name→codepoint map and font-merge support remain in `editor-sdk` for a future binding that fixes glyph rasterization; icons in native tab/menu labels (which can't host a drawn glyph) are text-only.

   The same binding defect applies to `CalcTextSize` (it defaults `text_end` to `""` and measures a zero-length range), so `ui.calcTextSize` computes width from a per-glyph advance for the monospace UI font instead. Correct measurement is load-bearing for the whole layout — right-aligned chrome (the menu-bar branch, the status bar), badge/chip sizing, and field truncation all depend on it.

5. **A `fontLoader` option on the WebGPU overlay** (`createImGuiOverlay(renderer, { fontLoader })`) selects the truetype (default) or freetype glyph backend, threaded into `ImGuiImplWeb.Init`.

## Consequences

- New editor panels/windows are one `addPanel` call — the scalability requirement is met structurally; the studio composes ~8 panels, the toolbar, the status bar, the menus, and the Project Settings dialog entirely against the SDK surface.
- The default layout depends on a hardcoded host-window id hash; if the host id string changes the layout falls back to a bare central node (panels float, user re-docks) rather than breaking. Documented at the constant.
- Procedural icons are a fixed vocabulary; an unknown name draws a neutral placeholder. This is the substitution the handoff anticipated ("the engine ships no icon font; swap freely"). Replacing it with a real font later is localized to `drawIcon`/`ui.icon` once the binding can rasterize one.
- The palette grew three semantic colors (`red400`, `magenta400`, `textMuted`) so axis/danger/play-mode/label colors come from the theme, not hardcodes.
- No bench: the shell and widgets are per-frame passthroughs into jsimgui's own draw, not content-scaling algorithms (§11). Verified end-to-end in the browser (WebGPU) against the three handoff screens.

## Implementation

- `packages/editor-sdk/src/editor.ts` — `Editor`, `createEditor`, `PanelDef`, `MenuDef`, `ToolbarDef`, `StatusBarDef`, `EditorContext`, `RailHeight`
- `packages/editor-sdk/src/editor-layout.ts` — `buildDefaultLayout`, `DockNodeId`, `DOCK_HOST_WINDOW_ID`, `nodeForSlot`, `DockSlot`, `LayoutDims`, `defaultDims`
- `packages/editor-sdk/src/components.ts` — `widgets`, `Widgets`, and the component option types
- `packages/editor-sdk/src/components-table.ts` — `dataTable`, `DataColumn`, `DataTableOptions`
- `packages/editor-sdk/src/components-asset.ts` — `assetCard`, `assetGroup`, `ASSET_TYPES`, `AssetType`
- `packages/editor-sdk/src/icon-shapes.ts` — `drawIcon` (procedural icon set)
- `packages/editor-sdk/src/icons.ts`, `icons-data.ts` — `iconGlyph`, `IconName`, `LUCIDE_CODEPOINTS`
- `packages/editor-sdk/src/draw.ts` — `Draw` (draw-list facade, logo cube, native-text fallback)
- `packages/editor-sdk/src/palette.ts` — `getActivePalette`, `srgbU32`, `packU32`, `axisColor`, `toneColors`, `Axis`, `Tone`
- `packages/editor-sdk/src/ui.ts` — expanded `Ui` surface (child, group, inputs, layout cursors, `icon`, popups)
- `packages/editor-sdk/src/fonts.ts` — `FontSpec.merge`/`glyphRanges` support
- `packages/editor-sdk/src/tokens.ts` — `RetroPalette.{red400, magenta400, textMuted}`
- `packages/renderer-webgpu/src/imgui-overlay.ts` — `ImGuiOverlayOptions.fontLoader`
- `apps/studio/src/{main.ts, state.ts, scene-data.ts, chrome.ts, project-settings.ts, panels-left.ts, panels-inspector.ts, panels-viewport.ts, panels-dock.ts}` — the composed studio editor
