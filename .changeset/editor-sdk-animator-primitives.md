---
'@retro-engine/editor-sdk': minor
---

feat(editor-sdk): inputText icon/hint, popups, item-deactivation, and new icons

Additive UI primitives the Animation Controller editor needs:

- `Ui.inputText` gains `icon` (a leading glyph inset inside the field, e.g. a search
  glyph) and honors `hint` (greyed placeholder when empty).
- `Ui.openPopup` / `Ui.popup` / `Ui.closePopup` for menu/dropdown surfaces, and
  `Ui.isItemDeactivated` to detect focus-out edits.
- New procedural icons: `minus`, `scan`, `git-fork`, `shuffle`, `move-horizontal`.
