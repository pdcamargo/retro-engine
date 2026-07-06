---
'@retro-engine/ui': minor
---

feat(ui): .rss (USS-subset) stylesheet parser + style resolution (phase 3)

Authors UI styling as a CSS/USS subset that resolves to `UiStyle`:

- `parseRss` — parses a `.rss` stylesheet into flat rules: comments, comma
  selector lists, and compound selectors (type / `#name` / `.class` / `:state` /
  `*`).
- `matches` / `specificity` — USS selector matching and specificity
  (`#name` > `.class`/`:state` > `Type` > `*`).
- `resolveDeclarations` — cascades the matching rules by specificity then source
  order (later wins).
- `resolveUiStyle` — maps the winning declarations onto a `UiStyle`
  (flex/box-model/alignment properties, `px`/`auto` lengths, `padding`/`margin`
  shorthands), with optional inline overrides winning as in USS.

Pure and headless, verified end-to-end against the flexbox layout engine (parse
→ resolve → lay out → assert). Combinators, `--var`/`var()`, and inheritance are
a later slice.
