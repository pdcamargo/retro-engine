---
'@retro-engine/ui': minor
---

feat(ui): UiText content + measureText bridge into the flex layout pass

Wires the engine's MSDF text layer into the UI layout engine (the documented
Text↔UI dependency), so a UI node can size itself to its text.

- `UiText` — an authored, reflection-registered content component (`text`, `font`
  handle, `fontSize`, `letterSpacing`, `lineHeight`). Requires `UiNode`, so a bare
  text entity still lays out. Visual styling (color/alignment) is a render-layer
  concern and is not carried here.
- `makeTextMeasure(uiText, fonts)` builds the intrinsic `MeasureFunc` for a text
  node, backed by `Font.measure` — shaping the text at the width the flex engine
  offers (wrapping when finite) and returning its natural block size. Returns
  `undefined` (leaving the node style-sized) when the text is empty, no font is
  set, or the font is not loaded yet.
- `UiPlugin` registers `UiText` and threads the `Fonts` store into the layout
  pass, attaching the measure func to leaf text nodes. Absent a `Fonts` store
  (no `TextPlugin`), nodes size by style alone — no hard dependency.

Verified headlessly: a `UiText` leaf sizes to its measured text in a flex row,
and stays style-sized when no font store is present (53 UI tests).
