# @retro-engine/ui

Retained, ECS-driven in-game UI for Retro Engine — a flexbox layout engine plus
(coming) a "Retro CSS" (`.rss`) styling layer, rendered through the engine's 2D
pipeline. This is the UI a *game* shows its players (menus, HUD, dialogs), not
the studio's editor UI.

Phase 1a ships the pure `FlexLayoutEngine` (single-line CSS flexbox: grow/shrink
with min/max clamping, `justify-content`, `align-items`/`align-self`, `gap`,
padding/margin, and `position: absolute` insets) behind a swappable
`LayoutEngine` interface with a text-measure callback hook.

See `docs/roadmap/ui-system.md` and `docs/adr/ADR-0150-in-game-ui-architecture.md`.
