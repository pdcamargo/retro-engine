---
'@retro-engine/ui': minor
---

feat(ui): in-game diagnostics overlay

`DiagnosticsOverlayPlugin` keeps a `UiText` node showing the live
`DiagnosticsStore` readout — `FPS 60  16.8ms  ents 42  assets 12`. Tag a
`UiText` (positioned + given a font) with the `DiagnosticsText` marker and the
plugin rewrites its text each frame:

```ts
app.addPlugin(new DiagnosticsPlugin());       // engine: fills the store
app.addPlugin(new DiagnosticsOverlayPlugin()); // ui: renders it
cmd.spawn(new UiNode({ position: 'absolute', left: 8, top: 8 }),
  new UiText({ text: '', font: monoFont }), new DiagnosticsText());
```

The formatting is a pure `formatDiagnostics(store)` (unit-tested); the widget
owns the text, you own placement and font.
