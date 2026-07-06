# ADR-0150: In-game UI architecture ("Retro CSS")

- **Status:** Accepted
- **Date:** 2026-07-06

## Context

The engine can render sprites, meshes, and (ADR-0149) text, but a game still has
no way to build menus, HUDs, or dialogs. The studio's own UI is ImGui
(ADR-0072), but that is editor tooling — a *game's* UI must live in the ECS,
serialize into scenes, and render through the game's own pipeline.

Two mature models informed the design: **Unity UI Toolkit** (a retained tree of
nodes styled by USS, a CSS subset, laid out by Yoga/flexbox) and **Bevy UI**
(ECS entities with `Node` + `Style`, a `UiSurface` that mirrors the entity tree
into a Taffy flexbox tree each frame, computed layout written back to
components). Both converge on: a **retained node tree**, **flexbox layout**, and
**CSS-like styling**. We adopt that convergence rather than inventing a model.

Key forces:

- **Composition (ADR-0001).** No `Widget` base class. A UI element is an entity
  with components; widgets are marker + data components + systems.
- **Reuse the hierarchy.** UI nesting *is* the engine's `Parent`/`Children`
  hierarchy — no parallel tree.
- **Layout must be swappable and testable.** Flexbox now; CSS grid and a
  WASM engine (Taffy) are plausible later. The layout algorithm must be a pure,
  GPU-free, unit-testable module behind an interface, not welded to the ECS.
- **Text is a dependency, not a coupling.** Layout needs to *measure* text, not
  render it — a measure callback (backed by ADR-0149's `measureText`) keeps the
  layout engine free of any renderer or font dependency.

## Decision

Ship in-game UI as a new package **`@retro-engine/ui`**, built in phases:

- **Layout engine (this phase, pure).** A `LayoutEngine` interface consuming a
  `LayoutNode` tree (resolved `UiStyle` + children + optional `MeasureFunc`) and
  producing a `LayoutResult` tree (border-box rects + content sizes). The first
  implementation, `FlexLayoutEngine`, is a **single-line CSS flexbox**: main-axis
  grow/shrink with min/max clamping and iterative freezing (CSS Flexible Box
  §9.7), `justify-content`, `align-items`/`align-self`, `gap`, padding, margin,
  and `position: absolute` insets. Pure TypeScript, no ECS, no GPU — fully
  unit-tested. Percentages, `flex-wrap`, and `baseline` are deferred.
- **Components + system (next).** `UiNode` (the authored `UiStyle`,
  reflection-registered) and a derived `ComputedLayout` (rect, **not
  serialized** — recomputed by the layout system, cf. §13). A `UiPlugin` walks
  the `Parent`/`Children` hierarchy into a `LayoutNode` tree, runs the engine
  with a text-measure callback, and writes `ComputedLayout` back.
- **Styling — "Retro CSS" (`.rss`, later).** A USS-subset parser + a
  style-resolution system matching type / `.class` / `#name` / state-marker
  selectors with cascade + inheritance, `--vars` via a theme resource, and
  pseudo-class markers (`Hovered`/`Focused`/`Pressed`/`Disabled`/`Checked`).
- **Rendering (later).** UI draws through the engine's 2D pipeline — background
  quads + borders (a UI material/pipeline) and text via the ADR-0149 glyph path.
- **Widgets (later).** Headless widget components (panel/label/button/image
  first) emitting `Message<T>` events; theming layered on top.

`@retro-engine/ui` depends on `math` and (once components land) `engine` +
`reflect`; `engine` never depends on `ui`. The layout engine core has no internal
dependencies.

## Consequences

- The hardest, most correctness-sensitive piece (flex resolution) lands first as
  a pure, exhaustively-tested module, de-risking everything above it and giving
  the UI a foundation that a future grid/Taffy engine can slot behind the same
  interface.
- Layout is decoupled from rendering and text: the engine only needs a measure
  callback, so it runs headlessly in tests and CI with no GPU.
- Reusing `Parent`/`Children` means UI entities are ordinary scene entities —
  they serialize, hot-reload, and appear in the hierarchy like anything else.
- Single-line flexbox is a deliberate first cut; wrap/grid/percentages are
  sequencing decisions (bigger algorithms), tracked in the roadmap — not a
  genre-based scope cut (§12). A game needing them gets them behind the same
  `LayoutEngine` interface.

## Implementation

- `packages/ui/src/ui-style.ts` — `UiStyle`, `Dimension`, `Edges`, `makeStyle`, axis helpers.
- `packages/ui/src/layout-engine.ts` — `LayoutEngine`, `LayoutNode`, `LayoutResult`, `MeasureFunc`.
- `packages/ui/src/flex-layout.ts` — `FlexLayoutEngine` (§9.7 resolution + justify/align/box model).
- `packages/ui/src/*` (next phases) — `UiNode`, `ComputedLayout`, `UiPlugin`; `.rss` parser; UI render pipeline; widgets.
