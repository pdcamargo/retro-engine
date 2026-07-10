# Custom collapsible UiNode inspector

- **Created:** 2026-07-10

## Context

A `UiNode`'s authored state is a single `style` struct with ~35 fields (display,
grid tracks, flex, min/max sizes, padding/margin/border edges, position insets,
background/border colors). The default inspector renders it as one flat,
indented list, and each edge struct (`padding` / `margin` / `borderWidth`) is
four separate rows — so a node inspector is a long scroll and the colors are
`vec4` shown as raw X/Y/Z/W number fields rather than a color picker.

The blocking usability issues are already fixed on `main`: optional/undefined
fields are now settable (a "Set" button, `packages/editor-sdk/src/inspector/property-field.ts`),
and the UI bundles/nodes render. This item is the polish pass to make the
`UiNode` inspector pleasant to author with, per user request.

Proposed shape:

- A grouped, **collapsible** layout: sections for Layout (display/grid), Flex,
  Spacing (padding/margin/gap), Size (min/max/basis), Position, and Appearance
  (background/border). Register via
  `editor.inspector.registerFieldRenderer('UiNode', ['style'], …)` and drive each
  sub-field through `PropertyContext.renderChild` so the baseline widgets (and the
  new Set affordance) are reused.
- A **color-picker** field renderer for `style.backgroundColor` / `style.borderColor`
  (they are `vec4`), defaulting to opaque on Set instead of transparent black.
- **Linked/compact edge editors** for `padding` / `margin` / `borderWidth` — one
  row with four fields (or a linked single field), instead of four rows each.

## Why deferred

- **Missing UI primitive.** The `Ui` surface (`packages/editor-sdk/src/ui.ts`)
  exposes `separatorText` and `indent`/`unindent` but no `collapsingHeader`;
  truly collapsible sections need a small new primitive wrapping
  `ImGui.CollapsingHeader`.
- **Design choices deserve a look:** which sections and their order, collapsible
  vs. just labeled sections, whether colors edit as RGBA or RGB+alpha, and
  whether edge editors link all four sides. Worth aligning before investing.
- Not blocking: UI authoring is functional today (visible bundles + settable
  fields + working nesting). This is ergonomics, not capability.

## Acceptance

- `Ui` has a `collapsingHeader(label, opts?)` primitive.
- Selecting a `UiNode` shows its style grouped into collapsible sections rather
  than one flat list, verified in the studio (Game/Scene inspector).
- `backgroundColor` / `borderColor` edit through a color picker with an opaque
  default when set; `padding` / `margin` / `borderWidth` edit as a single compact
  edge row.
- All edits remain undoable (routed through the history-backed edit emitter).
