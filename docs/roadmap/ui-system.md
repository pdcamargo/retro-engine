# In-Game UI System ("Retro CSS")

- **Created:** 2026-05-21 (rewritten 2026-07-06 to the retained ECS + flexbox + `.rss` model)
- **Status:** In progress (Phase 1a shipped 2026-07-06)
- **ADR:** [ADR-0150](../adr/ADR-0150-in-game-ui-architecture.md)

## Goal

The UI a *game* built on Retro Engine shows its players — menus, HUD, dialogs,
inventories — as ECS entities styled by a CSS subset and laid out with flexbox,
rendered through the engine's 2D pipeline. Not the studio's editor UI (that's
ImGui, `studio-imgui.md` / ADR-0072). Model: Unity UI Toolkit (retained tree +
USS + flexbox) ∩ Bevy UI (ECS `Node`/`Style` + `UiSurface` mirror). Lives in
`@retro-engine/ui`.

Done when a game can build a main menu (buttons), a settings dialog (sliders),
and a HUD (text + bars) from ECS components + `.rss`, with gamepad navigation.

## Phases

### Phase 1a — Layout engine (pure) ✅ (2026-07-06)

- `LayoutEngine` interface + `LayoutNode`/`LayoutResult`/`MeasureFunc` types.
- `FlexLayoutEngine`: single-line CSS flexbox — main-axis grow/shrink with
  min/max clamping + iterative freezing (§9.7), `justify-content`,
  `align-items`/`align-self`, `gap`, padding, margin, `position: absolute`
  insets. `UiStyle` + `makeStyle`. Pure TS, no ECS/GPU; 21 unit tests + bench.

### Phase 1b — Components + layout system ✅ (2026-07-06)

- `UiNode` (authored `UiStyle`, reflection-registered; `undefined` = auto/no-max
  so it serializes cleanly) + derived `ComputedLayout` (absolute rect; **not
  serialized**, auto-attached). `UiPlugin`: `postUpdate` `ui-layout` system walks
  `Parent`/`Children` → `LayoutNode` tree → runs the engine → writes
  `ComputedLayout` with accumulated absolute coords. `UiViewport` (root size) +
  `UiLayout` (swappable engine) resources. Verified on a bare ECS `World` +
  reflection round-trip (29 UI tests total).

### Phase 1c — Text content + measure bridge ✅ (2026-07-06)

- `UiText` (authored, reflection-registered: `text`, `font`, `fontSize`,
  `letterSpacing`, `lineHeight`; requires `UiNode`) + `makeTextMeasure` build the
  intrinsic `MeasureFunc` from the engine text layer (`Font.measure`, ADR-0149),
  which `UiPlugin` attaches to leaf text nodes so flexbox sizes a node to its
  text (wrapping to the offered width). Graceful when no `Fonts` store is present
  (nodes size by style). This is the ADR-0149 `measureText` measure-callback
  wiring the layout system was waiting on. 53 UI tests.

### Phase 2 — Rendering

- **Phase 2a — background quads ✅ (2026-07-06, ADR-0154).** `UiRenderPlugin`
  composites `UiNode` `backgroundColor` fills over the scene via a once-per-frame
  screen-space overlay render-graph node (`UiPassNode`, `loadOp: 'load'`, after
  the camera driver). `UiStyle.backgroundColor`, `UiPipeline` (camera-free
  alpha-blended quads; CPU clip-space mapping, no bind groups), `computeClipRect`
  / `packUiQuad`. Painted in the layout's depth-first `ComputedLayout.order` so
  children draw over their parent. Verified in a real browser via the
  `sample-game` web export (nested flex HUD panel). Bench: `ui-quad-pack`.
- **Phase 2b — in-UI text ✅ (2026-07-06, ADR-0154).** `UiText` glyphs draw via a
  screen-space MSDF pipeline (`UiTextPipeline`, reusing `Font.layout` + the font
  atlas), positioned at the node's content-box origin, in a second overlay node
  (`UiTextPassNode`) ordered after the quad pass. `UiText.color`, `packUiGlyph`,
  per-atlas batching. Verified in a real browser (HUD labels in the sample-game
  export). Bench: `ui-text-pack`.
- **Phase 2c — borders ✅ (2026-07-06).** `UiStyle.borderWidth` (per-side Edges) +
  `borderColor`; the prepare pass emits up to four inset edge quads per node
  (`borderEdgeRects`, CSS border-box), reusing the quad pipeline. Verified in a
  real browser (outlined HUD panel + menu buttons in the sample-game export).
- Remaining (2d+): corner radius; per-line text alignment within a node;
  clipping/overflow; explicit z-index + interleaved text/quad ordering; a
  UI-specific camera/scaling mode (fixed logical resolution + letterbox).

### Phase 3 — Retro CSS (`.rss`) 🟡 (parser + cascade shipped 2026-07-06)

- ✅ `parseRss` (comments, comma lists, compound type/`#name`/`.class`/`:state`/`*`
  selectors) + `matches`/`specificity` + `resolveDeclarations` (specificity →
  source-order cascade) + `resolveUiStyle` (declaration → `UiStyle` mapping:
  flex/box-model/alignment, `px`/`auto`, `padding`/`margin` shorthands, inline
  overrides). Pure, verified end-to-end against the layout engine.
- ✅ **Phase 3b — runtime wiring (2026-07-06).** `resolveUiStyle` now also maps the
  **paint** properties (`background-color`/`border-color`/`border-width` + the
  `border` shorthand) via a CSS color parser (`parseColor`: `#rgb`/`#rgba`/`#rrggbb`/
  `#rrggbbaa`, `rgb()`/`rgba()`, named colors → `[0,1]` `Vec4`). A `UiStyleSheet`
  resource holds the active parsed rules (`setUiStyleSheet(app, rss)`); a `UiClass`
  component (reflection-registered: `classes`/`name`/`type`) gives a node its
  selector identity; and a `postUpdate` `'ui-style'` system (before `'ui-layout'`)
  resolves every `UiClass` node's `UiStyle` from the sheet each frame — deriving
  pseudo-class **states** (`hovered`/`pressed` from `UiInteraction`, `disabled` from
  the `Disabled` marker) so hover/press/disable reflow live. Verified in a real
  browser (sample-game export): `.chip` → blue, `.chip.alt` compound override →
  orange, and a `.chip:hovered` rule flips a chip to red on live pointer hover.
  Bench: `rss-style`.
- Remaining: descendant/child **combinators**, `--var`/`var()` custom properties
  (theme resource) + **inheritance**, per-node **inline overrides** merged over the
  sheet, and a `.rss` **asset kind** (load the sheet from a project file, not just a
  source string). `focused`/`checked` states await focus/checkbox widgets.

### Phase 4 — Widgets + interaction

- **Phase 4a — picking + interaction state ✅ (2026-07-06).** `Interactable`
  marker + `UiInteraction` state (`none`/`hovered`/`pressed`) + `UiClicked`
  message; `pickTopmost` hit-test (front-most by paint order) + `updateUiInteraction`
  state machine; `UiInteractionPlugin` runs it in `preUpdate` after input
  (`@retro-engine/input`). Verified in a real browser (a clickable button +
  live click counter in the sample-game export). Bench: `ui-picking`.
- **Phase 4b — button widget ✅ (2026-07-06).** `UiButton` (normal/hovered/
  pressed/disabled palette; a built-in system tints the node by `UiInteraction`
  state) + `Disabled` marker (picking skips it) + `setUiBackground` runtime style
  setter. Verified in a real browser (a 3-button main menu with a disabled entry
  routing `MenuAction`s to a label, in the sample-game export).
- Remaining (4c+): more widget components (label/toggle/slider/scrollview/
  text-input/dropdown/tabs) with `Message<T>`; keyboard/gamepad focus routing;
  a full menu/HUD sample scene styled by `.rss`.

### Later (P1+)

- CSS grid behind the `LayoutEngine` interface; `flex-wrap`; percentages;
  virtualized list/tree; data binding; spatial (gamepad) navigation; screens as
  scenes/states.

## Open questions (resolved / remaining)

- **Layout model** → flexbox first, behind a swappable interface (grid/Taffy
  later). Resolved (ADR-0150).
- **Text** → ADR-0149 MSDF/SDF text; layout consumes `measureText` via a
  callback. Resolved.
- **Reactive updates** → pull-based via change detection (recompute on dirty).
- **Picking / focus** → a `UiFocus` resource + hit-test against `ComputedLayout`
  (Phase 4).
- **DPR / resolution** → UI in logical pixels; the renderer scales.

## Links

- [ADR-0150](../adr/ADR-0150-in-game-ui-architecture.md) · [MASTER-ROADMAP](MASTER-ROADMAP.md)
- Depends on: [text-rendering.md](text-rendering.md) (ADR-0149 `measureText` + glyph path)
- Sibling: `studio-imgui.md` (the *studio's* UI; this is the *game's* UI)
- External: Unity UI Toolkit / USS; Bevy UI `Node`/`UiSurface`; CSS Flexible Box §9.7
