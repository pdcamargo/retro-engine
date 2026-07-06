---
'@retro-engine/ui': minor
---

feat(ui): `.rss` custom properties — `--vars`, `var()`, and a runtime theme

Adds CSS custom properties to the `.rss` (USS-subset) style system.

- `collectThemeVars(rules)` gathers every `--name` declaration into a flat theme
  (later declarations win); `substituteVars(value, vars)` resolves
  `var(--name)` / `var(--name, fallback)` references. `resolveUiStyle` gained a
  `vars` argument and substitutes before mapping declarations (auto-collecting the
  sheet's own vars when none are passed).
- New `UiTheme` resource + `setUiThemeVars(app, vars)`: overrides merged on top of
  the sheet's `--vars`, so `var()` usages re-theme at runtime (e.g. flip an accent
  color from game code). `UiPlugin` inserts it and the `'ui-style'` system merges
  it (once per pass) into every node's `var()` resolution.
- The `border` shorthand now also parses functional colors (`rgb(r, g, b)` with
  internal spaces), not just hex.

Additive. Unit-tested (var collection/substitution, sheet vars, theme override,
functional-color border) and verified in a real browser via the sample-game export:
chips fill via `var(--accent)`, and a runtime `--accent` override recolors the
accent chips while the `var(--alt)` chip is unaffected.
