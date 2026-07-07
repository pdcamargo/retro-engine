# ADR-0163: UI focus and navigation

- **Status:** Accepted
- **Date:** 2026-07-06
- **Relates to:** the in-game UI system (`@retro-engine/ui`) and its interaction layer

## Context

The UI had pointer interaction (`Interactable` / `UiClicked` / `UiPointer`) but
no **focus** — the "which widget is active" concept a keyboard or gamepad drives.
Focus is the prerequisite for a text-input widget (where do typed characters go?),
for gamepad-navigable menus (no mouse), and for accessibility. Two design
questions: how focus moves between widgets, and how that stays decoupled from any
one input device (a menu may be driven by arrow keys, Tab, a d-pad, or a stick).

## Decision

A single-focus resource, marker-opt-in focusables, and **message-driven**
navigation with a pure geometry core.

- **`UiFocus` resource** — `{ current: Entity | null }`, the one focused node.
  Runtime state, not serialized. Widgets read it (e.g. to draw a focus ring or
  route activation). Single focus (not per-node `Focused` flags) keeps "move
  focus" a one-line update and avoids reconciling multiple truth sources.
- **`Focusable` marker** — a node opts into focus by carrying it (authored,
  reflection-registered; auto-attaches `UiNode`/`ComputedLayout`).
- **`UiNavigate` message** — the input seam. Game code maps whatever device it
  likes (Tab, arrows, d-pad, stick) to a `UiNavigate(direction)` and writes it;
  the focus system consumes it. The focus layer never reads a keyboard or gamepad
  directly, so it is device-agnostic and testable without input plumbing — the
  same decoupling the action map gives gameplay.
- **Two navigation modes, one pure module.** `'next'`/`'prev'` are sequential
  (tab order = layout paint order, a stable parent-before-child / sibling-order
  proxy); `'up'`/`'down'`/`'left'`/`'right'` are spatial — nearest neighbour by a
  **distance-along-axis + perpendicular-penalty** cost, so an aligned neighbour
  beats a closer but skewed one, considering only candidates beyond the current
  node on the axis. Both are pure functions (`tabNavigate` / `spatialNavigate`)
  over a minimal `FocusNode` (id + box), unit-tested independently of the ECS.
- **Stale-focus clearing.** The system drops `UiFocus.current` if it no longer
  names a focusable node (despawned or un-marked), so focus never dangles.

## Consequences

- A gamepad menu is: spawn `Focusable` nodes, map the d-pad to `UiNavigate`, read
  `UiFocus.current` — no mouse required. Tab-order forms and directional grids
  both work off the one resource.
- The message seam means focus needs no `InputPlugin` dependency and no
  device-specific code; a test drives it by writing `UiNavigate` directly.
- The spatial heuristic is intentionally simple (axis + perpendicular weight); a
  richer beam/overlap model can replace `spatialNavigate` without touching the
  resource, marker, or message.
- **Not in this slice:** activating the focused widget (Enter/Space/South →
  click the focused node) and a focus-ring visual. Both build on `UiFocus` and
  are tracked follow-ups.

## Implementation

- `packages/ui/src/focus/focus-nav.ts` — `FocusNode`, `NavDirection`, pure
  `tabNavigate` / `spatialNavigate`.
- `packages/ui/src/focus/ui-focus.ts` — `UiFocus` resource, `Focusable` marker,
  `UiNavigate` message.
- `packages/ui/src/focus/ui-focus-plugin.ts` — `UiFocusPlugin`: consumes
  `UiNavigate`, sorts focusables into tab order, moves focus, clears stale focus.
