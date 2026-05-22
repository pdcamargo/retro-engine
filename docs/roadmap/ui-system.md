# In-Game UI System

- **Created:** 2026-05-21
- **Status:** Future direction (sketch — separate from studio ImGui)

## Goal

An in-game UI system that lives inside the engine and is driven by the ECS. Not to be confused with `docs/roadmap/studio-imgui.md`, which is the studio's editor UI via jsimgui. This file covers the UI a *game* built on Retro Engine renders to its players — menus, HUD, dialogs, inventories — using engine components and systems, not an immediate-mode toolkit.

Bevy's approach (post-0.17) splits UI into **headless widgets** (`Button`, `Slider`, `Checkbox`, `RadioButton` — interaction logic only, no styling) and **Feathers** (an opinionated styled widget library on top). We adopt the same split: headless widget components are the engine's contribution; theming is either a separate package or left to game code.

We're done when a game can build a main-menu screen with buttons, a settings dialog with sliders, and a HUD with text + bars, all using ECS components, queried and updated by engine systems, with gamepad navigation working out of the box.

## Phases

1. **Layout primitives** — `UiNode`, `Layout` (flex-like or absolute, TBD), `Size`, `Anchor`. Sit on top of the M2 Transform + Hierarchy stack — UI is a hierarchy of nodes with computed positions.
2. **Headless widget components** — `Button`, `Checkbox`, `Slider`, `RadioButton`, `TextInput`. Each emits `Message<T>` events (e.g., `ButtonPressed { entity: Entity }`) on interaction. No visuals.
3. **Theming and styled widgets** — separate layer that consumes headless widgets and adds `BackgroundColor`, `BorderColor`, `Icon`, etc. components per widget state (`Hovered`, `Pressed`, `Disabled`).
4. **Text rendering** — font asset, glyph atlas, text shaping. Likely consumes the asset system (`asset-system.md`).
5. **Spatial navigation** — directional gamepad/keyboard navigation between focusable widgets. Bevy 0.18 does this automatically based on layout; we steal the idea.
6. **Screens as scenes** — a UI screen (main menu, settings) is a `States` value with associated scene. Transitioning to `MainMenu` spawns the menu scene; transitioning out tears it down. Hooks into `docs/roadmap/scenes-and-prefabs.md`.
7. **Input integration** — UI consumes input events with first dibs; game-input handling reads what's left. Coordinates with `docs/roadmap/input-system.md`.

## Open questions

- **Layout model.** Flexbox-style (similar to Bevy + CSS), absolute positioning, constraint-based (springs / pins), or some hybrid? Bevy went flexbox; it's familiar but constrains pixel-perfect retro layouts. Default lean: simple flex + absolute escape hatches.
- **Text rendering — SDF, raster, or vector?** Pixel-perfect retro fonts (bitmap) are the easy default; SDF gets you smooth scaling. Default lean: bitmap-first, SDF when needed.
- **Reactive updates.** A score display reading `Res<Score>` re-renders when the resource changes. Push-based via observers or pull-based via change-detection? Both work; pull-based with change detection is simpler.
- **Picking / input routing.** Bevy uses `bevy_picking` (a separate crate). We need something equivalent: which widget is under the cursor, which has focus, who gets the click event. Could be a `UiFocus` resource.
- **Modal / popup ordering.** Z-ordering for popups, modals, tooltips. Reuses `transform-and-hierarchy.md` Z-ordering work.
- **DPR + resolution scaling.** The engine already manages canvas backing size via `ResizeObserver`. UI nodes need to be in logical pixels, the renderer scales.
- **Editor for UI layouts.** Far-future; on the studio side. Listed for completeness.

## Links

- Foundation: `docs/roadmap/engine-foundations.md` (M2 Transform + Hierarchy + States are all consumed)
- Sibling: `docs/roadmap/studio-imgui.md` — that's the *studio's* UI via jsimgui; this file is the *game's* UI via ECS.
- Prereq: `docs/roadmap/input-system.md` (focus + cursor routing)
- Prereq: `docs/roadmap/asset-system.md` (fonts, icons as assets)
- Prereq: `docs/roadmap/scenes-and-prefabs.md` (UI screens = scenes)
- Consumer: `docs/roadmap/transform-and-hierarchy.md` (Z-ordering for modals/popups)
- ADR-0001 (composition — UI is components + systems, no UI base class)
- External:
  - Bevy headless widgets ([Bevy 0.17 release notes](https://bevy.org/news/bevy-0-17/))
  - Bevy Feathers ([docs.rs/bevy/feathers](https://docs.rs/bevy/latest/bevy/feathers/index.html))
  - Bevy UI standard widgets example ([bevy.org examples](https://bevy.org/examples/ui-user-interface/standard-widgets/))
