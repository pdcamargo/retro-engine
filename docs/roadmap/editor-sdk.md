# Editor SDK — `@retro-engine/editor-sdk`

- **Created:** 2026-05-21
- **Status:** In progress — package created with the immediate-mode UI foundation (ADR-0072)

## Goal

`packages/editor-sdk` is the public extension surface for the studio. Plugins can register custom windows, custom dialogs, custom inspectors, and custom asset importers without forking the studio. The SDK is the only thing third-party tooling depends on; the studio's internals stay private.

## Progress (2026-06-12) — ADR-0072

`packages/editor-sdk` now exists. It ships the **UI foundation** the phases below build on:

- `ui` — a normalized, typed, immediate-mode wrapper over Dear ImGui (`ui.window`, `ui.button`, `ui.text`, `ui.checkbox`, `ui.sliderFloat`, `ui.dragFloat`, `ui.colorEdit3`, …). This is the first-class consumer surface; raw jsimgui is never exposed.
- `ThemeTokens` / `defaultTokens` / `applyTheme` — token-driven theming (typed TS is the canonical token format; placeholder tokens until a design export lands).
- `uiOverlayPlugin` — drives the per-frame UI on top of the engine render, via the backend-neutral `SurfaceOverlay` injected from the active renderer.
- **Docking** — `uiOverlayPlugin({ docking: true })`, `ui.dockSpaceOverViewport`, per-window `dock`.
- **Dock-layout save/restore** — `saveLayout` / `loadLayout` (Dear ImGui `ini`) plus a `layout` option: a baked **default layout** and consumer-provided `persist`/`restore` sinks (so the studio can later store layouts in a project file, not just `localStorage`). Validated in the playground: a default split layout opens pre-docked, user changes persist, and a saved layout is restored over the default. This is the mechanism the docking layout (phase 1) and a future layout-reset/preset command build on.

Window/dialog/inspector/menu registration (phases 1–4) layer on top of this `ui` surface.

## Future direction — declarative authoring over the immediate-mode core

A higher-level, declarative/CSS-like authoring layer (Unity UI-Toolkit / USS analog) for *editor* UI is a candidate future layer **on top of** the immediate-mode `ui` core — describe panels as data/markup, drive ImGui underneath, with the token layer as the styling source of truth. Deferred deliberately: the immediate-mode surface ships first because it matches ImGui's grain; a declarative layer is additive and gets its own ADR when scoped. (Distinct from `docs/roadmap/ui-system.md`, which is the *in-game* ECS UI.)

## Phases

1. **Window registration API** — declare a window class (or factory), get a slot in the studio's docking layout. Lifecycle hooks: `onOpen`, `onTick`, `onClose`.
2. **Dialog API** — modal and modeless dialogs, return promises for results.
3. **Inspector registration** — given a component type, register a custom editor view. Defaults to a generic reflective inspector.
4. **Menu / command palette API** — register commands; bind keyboard shortcuts.
5. **Plugin manifest + loader** — declare plugins in `retro-project.json` or similar; hot-reload during dev.
6. **Engine introspection** — read-only access to the running `App` for editor-side queries.

## Open questions

- Are plugins JS modules (dynamic import) or bundled at build time? Dynamic import is more flexible but requires careful sandboxing.
- What gets re-exported from `editor-sdk` vs kept studio-internal? Anything reachable becomes API surface.
- Inspector reflection: TC39 decorators, runtime registry, or schema files?
- Cross-plugin communication: event bus, direct calls, or strict isolation?

## Links

- ADR-0001 — architecture foundations (composition + plugins)
- ImGui's docking branch: https://github.com/ocornut/imgui/wiki/Docking
- Sanity Studio's plugin API (reference shape)
