---
'@retro-engine/ui': minor
---

feat(ui): `:focused` and `:checked` .rss pseudo-classes driven by live state

The `.rss` resolver already matched `:focused` / `:checked`, but nothing emitted
them. `deriveStates` now adds `checked` for a checked `UiToggle` and `focused`
for the `UiFocus.current` node, so state-driven styling works:

```css
Toggle:checked { background-color: #3a6; }
Button:focus  { border-color: #fff; }   /* a focus ring, no engine border code */
```

`resolveUiStyles` gained an optional `focusedEntity` argument (defaults to none);
the `ui-style` system soft-reads the `UiFocus` resource (present only when
`UiFocusPlugin` is added), so the style pass runs unchanged without focus wired
up. This is the focus-ring visual for the focus/navigation work — authored purely
in `.rss`.
