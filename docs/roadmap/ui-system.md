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

### Phase 1b — Components + layout system (next)

- `UiNode` (authored `UiStyle`, reflection-registered) + derived `ComputedLayout`
  (rect; **not serialized**). `UiPlugin`: walk `Parent`/`Children` → `LayoutNode`
  tree → run engine (text-measure callback = ADR-0149 `measureText`) → write
  `ComputedLayout`. Tested via a headless App (spawn tree → assert layout).

### Phase 2 — Rendering

- UI draws through the 2D pipeline: background quads + borders (a UI material)
  and text via the ADR-0149 glyph path; a UI camera / screen-space pass; z-order.

### Phase 3 — Retro CSS (`.rss`)

- USS-subset parser + style-resolution system: type / `.class` / `#name` /
  state-marker selectors, cascade + inheritance, `--vars` via a theme resource,
  pseudo-class markers (`Hovered`/`Focused`/`Pressed`/`Disabled`/`Checked`).

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
