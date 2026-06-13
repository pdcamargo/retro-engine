---
'@retro-engine/editor-sdk': minor
---

feat(editor-sdk): Retro Engine design-system theme (palette + full ImGui slot map)

Replace the placeholder tokens with the Retro Engine design system: a phosphor-green-on-cool-charcoal palette plus the complete `ImGuiCol_` slot map and `ImGuiStyle` spacing/border/rounding/alignment vars, with the design's opinions baked in (green is a highlight only, surfaces step up the neutral ramp on hover→active, 1px borders over shadows, sharp corners, selected tab merges into its panel body under a green overline).

`ThemeTokens` is now `{ palette, metrics }` — the `RetroPalette` (~21 sRGB colors) is the canonical reskin knob; `applyTheme` maps it onto every slot. Adds the `FontScale` type ramp. `resolveTheme` normalizes metrics (clamps lengths and alignments). Font loading (JetBrains Mono / Silkscreen) is deferred — the theme uses the default font for now.
