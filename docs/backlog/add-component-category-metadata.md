# Add Component picker — registry-level category metadata

- **Created:** 2026-06-20

## Context

The studio's Add Component popup (`apps/studio/src/add-component-popup.ts`) groups
registered components into a drill-down category tree (Rendering ▸ Light, Physics,
Audio, …). The grouping, per-component icon, and one-line description currently come
from a **studio-side static `CATALOG` map keyed by component name**, with anything
unmapped falling into an "Uncategorized" bucket.

That works, but it means a component's category lives in the editor, not with the
component, so newly registered engine/user components are uncategorized until the map
is edited — and the studio is the only consumer that can categorize them.

The right home is the reflection registration itself: extend `RegisterOptions`
(`packages/reflect/src/type-registry.ts`) with optional `category?: string`
(and possibly `icon`/`description`), store it on `RegisteredType`, and have
`app.registerComponent(Ctor, schema, { category: 'Rendering/Light', … })` carry it.
The picker then builds the tree from registry data and the `CATALOG` stopgap is
deleted (or kept only as a fallback for components that opt out).

## Why deferred

Scoped out of the Add Component / Save Scene / splash slice to keep that change
contained — adding a field to the reflection registry touches a shipped leaf package
(`@retro-engine/reflect`) and every `registerComponent` call site across the engine,
which is its own pass. The studio-side map ships the feature now without that churn.

## Acceptance

- `RegisterOptions`/`RegisteredType` carry component category (+ optional icon/desc)
  and engine components register theirs.
- The Add Component popup builds its tree from registry metadata; the studio-side
  `CATALOG` map is gone (or demoted to a fallback for unannotated components).
- A newly registered component appears under its declared category with no studio
  edit.
