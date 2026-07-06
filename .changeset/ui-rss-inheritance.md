---
'@retro-engine/ui': minor
---

feat(ui): `.rss` custom-property inheritance (cascade down the UI tree)

Custom properties now inherit through the UI hierarchy, matching CSS semantics.

- `resolveUiStyles` walks `Parent`/`Children` instead of resolving each node in
  isolation. `*` / `:root` custom properties (`collectGlobalVars`) form a global
  base; an element selector's `--vars` (`resolveNodeVars`) inherit down to a
  matching node's descendants and override the inherited value within that
  subtree. A node without a `UiClass` keeps its authored style but still passes
  inherited vars to its children.
- The `UiTheme` resource seeds the global base (a runtime `:root`-like override),
  so a `.themed { --accent: … }` subtree keeps its scoped value even after a
  runtime re-theme.

Additive — a flat tree (all UI roots) resolves exactly as before. Unit-tested
(subtree override + inheritance) and verified in a real browser via the
sample-game export: a chip inside a `.themed` container inherits its green
`--accent` while sibling chips stay the global blue, and stays green after a
runtime `--accent` re-theme recolors the flat chips.
