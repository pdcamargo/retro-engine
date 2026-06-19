---
'@retro-engine/editor-sdk': minor
---

feat(editor-sdk): `InspectorRegistry.describe()` enumerates customizations (ADR-0094)

Adds `InspectorRegistry.describe(): readonly InspectorCustomization[]` — reports which
components have a custom whole-component editor, per-field renderers, or amendments. Feeds
the studio's project index (a "this component has a custom editor" view). Global
kind/widget/type renderers are not per-component and are not reported.
