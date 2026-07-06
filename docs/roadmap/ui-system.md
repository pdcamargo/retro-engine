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
- Remaining (2b+): borders + corner radius; in-UI **text** via the ADR-0149
  glyph path; clipping/overflow; explicit z-index; a UI-specific camera/scaling
  mode (fixed logical resolution + letterbox).

### Phase 3 — Retro CSS (`.rss`) 🟡 (parser + cascade shipped 2026-07-06)

- ✅ `parseRss` (comments, comma lists, compound type/`#name`/`.class`/`:state`/`*`
  selectors) + `matches`/`specificity` + `resolveDeclarations` (specificity →
  source-order cascade) + `resolveUiStyle` (declaration → `UiStyle` mapping:
  flex/box-model/alignment, `px`/`auto`, `padding`/`margin` shorthands, inline
  overrides). Pure, verified end-to-end against the layout engine.
- Remaining: descendant/child **combinators**, `--var`/`var()` custom properties
  (theme resource) + **inheritance**, and wiring resolution into the `UiPlugin`
  layout pass (a `Stylesheet` resource + `.rss` asset kind) with state-marker
  components (`Hovered`/`Focused`/`Pressed`/`Disabled`/`Checked`).

### Phase 4 — Widgets + interaction

- Headless widgets (panel/label/button/image first; then toggle/slider/
  scrollview/text-input/dropdown/tabs) emitting `Message<T>`; picking/focus
  routing; a HUD/menu sample.

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
