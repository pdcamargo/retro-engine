# @retro-engine/ui

## 0.1.0

### Minor Changes

- c00cc75: feat(ui): in-game diagnostics overlay

  `DiagnosticsOverlayPlugin` keeps a `UiText` node showing the live
  `DiagnosticsStore` readout — `FPS 60  16.8ms  ents 42  assets 12`. Tag a
  `UiText` (positioned + given a font) with the `DiagnosticsText` marker and the
  plugin rewrites its text each frame:

  ```ts
  app.addPlugin(new DiagnosticsPlugin()); // engine: fills the store
  app.addPlugin(new DiagnosticsOverlayPlugin()); // ui: renders it
  cmd.spawn(
    new UiNode({ position: "absolute", left: 8, top: 8 }),
    new UiText({ text: "", font: monoFont }),
    new DiagnosticsText()
  );
  ```

  The formatting is a pure `formatDiagnostics(store)` (unit-tested); the widget
  owns the text, you own placement and font.

- 056bfc9: feat: expose feature-component reflection registration independent of the plugins

  Each feature plugin now factors its component-schema registration into a standalone, exported function so a host (e.g. an editor's component palette) can register the component _types_ for authoring and serialization without installing the plugin's systems or render passes.

  New public surface:

  - `@retro-engine/physics-core`: `registerPhysicsComponents(app)` — all 2D/3D bodies, colliders, velocities, forces, materials, character controllers, and joints.
  - `@retro-engine/audio`: `registerAudioComponents(app)` — `AudioSource`, `AudioListener`.
  - `@retro-engine/input`: `registerInputComponents(app)` — `ActionBinding`/`ActionDef` value types + the `ActionMap` component.
  - `@retro-engine/ui`: `registerUiComponents(app)` — every UI component (layout, text, image, style class, button/toggle/slider/text-input, and the interaction/focus/diagnostics markers), plus the now-exported `uiButtonSchema` / `uiToggleSchema` / `uiSliderSchema` / `uiTextInputSchema`.
  - `@retro-engine/engine`: `registerSpriteComponents(app)`, `registerLight2dComponents(app)`, `registerTextComponents(app)` — the sprite (+ atlas), 2D light, and text component schemas.

  Each owning plugin's `build` now delegates to its function, so behavior is unchanged. Registering the same constructor twice is idempotent, so calling these alongside the full plugin is safe.

- 7326de4: feat(ui): node borders (UI phase 2c)

  UI nodes can draw a border. `UiStyle` gains `borderWidth` (per-side `Edges`, with
  the same scalar/partial shorthand as padding/margin) and `borderColor` (linear
  RGBA `Vec4`); both reflection-registered on `UiNode`. The overlay prepare pass
  emits up to four inset edge quads per node (CSS `border-box`; corners are not
  double-covered), painted over the node's own background and behind its children
  via the existing depth-first order — no new pipeline, it reuses the UI quad path.
  `borderEdgeRects` is the pure, tested edge-geometry helper.

  Verified in a real browser (the `sample-game` export's HUD panel and menu
  buttons now show outlines). 77 UI tests.

- 38e5914: feat(ui): UiButton widget + Disabled state (UI phase 4b)

  Ergonomic buttons on top of the interaction layer — enough to build a menu.

  - `UiButton` — a button's background palette (`normal`/`hovered`/`pressed`/
    `disabled`); a built-in `UiInteractionPlugin` system drives the node's
    `backgroundColor` from it by the node's `UiInteraction` state, so games no
    longer hand-write hover/press tinting. Requires the `Interactable` machinery
    (and thus a `UiNode`). Reflection-registered.
  - `Disabled` — an authored marker; picking ignores it (no hover/press/click) and
    `UiButton` shows the disabled color. Reflection-registered.
  - `setUiBackground(node, color)` — the supported way to recolor a node at runtime
    (the resolved `UiStyle` is otherwise read-only).
  - `pickTopmost` / `updateUiInteraction` now skip `disabled` entries.

  Verified end-to-end: the `sample-game` export renders a centered 3-button main
  menu (NEW GAME / LOAD [disabled] / QUIT) with built-in button styling; clicking
  an enabled button routes its `MenuAction` to a "LAST: …" label, and the disabled
  button is inert — driven through the real input backend in a browser (Playwright).
  74 UI tests. Widget set (label/toggle/slider/…) + focus/spatial nav still to come.

- 056bfc9: feat(ui): camera/target-bound UI rendering (ADR-0174)

  The UI passes now render into a camera's render target instead of always
  overlaying the swapchain, so in-game UI can be composited into an offscreen
  camera texture (e.g. the studio's Game viewport, render-to-texture UI).

  - New `UiCamera` marker component: attach it to the camera whose target should
    host the UI. The UI renders into that camera's resolved target (swapchain for a
    primary camera, texture for a texture camera) and `UiViewport` is sized to it.
    At most one UI camera is honored per frame (a main camera wins, else the first
    in dispatch order).
  - New `UiRenderPluginOptions.overlayWhenNoCamera` (default `true`): with no
    `UiCamera` the UI falls back to the previous full-surface overlay, so existing
    games are unchanged. Hosts rendering into offscreen textures pass `false`.
  - The UI pipelines are now specialized on the **target's** color format rather
    than the surface format.
  - New exports: `UiCamera`, `UiRenderTargetState`, `pickUiCameraView`,
    `uiTargetView`, `UiRenderPluginOptions`. The internal prepare helpers
    (`prepareUiQuads` / `prepareUiImages` / `prepareUiText`) take additional
    arguments (target format, and a default-font handle for text).

  Also:

  - `UiText` / `Text` with no explicit font now fall back to the engine's built-in
    default font (see the engine changeset), so text renders without a font asset.
  - Assigning `UiNode.style` now normalizes the value through `makeStyle`, so a
    partial style (e.g. from scene/reflection decode or a hand-built object) is
    completed with defaults. This fixes a bug where a UiNode decoded from partial
    data laid out to `NaN` size and never rendered.

- 2bb81d0: feat(ui): new @retro-engine/ui package with a pure flexbox layout engine (phase 1a)

  Introduces the in-game UI package with the layout foundation:

  - `LayoutEngine` interface + `LayoutNode` / `LayoutResult` / `MeasureFunc` types.
  - `FlexLayoutEngine` — a single-line CSS flexbox implementation: main-axis
    grow/shrink with min/max clamping and iterative freezing (CSS Flexible Box
    §9.7), `justify-content`, `align-items` / `align-self`, `gap`, padding, margin,
    and `position: absolute` insets. Pure TypeScript — no ECS, no GPU — with a
    text-measure callback hook.
  - `UiStyle` + `makeStyle` (fully-defaulted style struct with edge shorthands).

  ECS components (`UiNode` / `ComputedLayout`), the layout system, `.rss` styling,
  rendering, and widgets land in later phases.

- d78c7e9: feat(ui): focus activation (Enter / gamepad → click the focused widget)

  Completes UI focus (Phase 2). A `UiActivate` message tells the focus system to
  activate `UiFocus.current`, which it does by emitting a `UiClicked` on that
  entity — so keyboard/gamepad activation drives the exact same click path as the
  pointer, and buttons, toggles, and anything reading `UiClicked` respond
  identically:

  ```ts
  app.addSystem("update", [MessageWriter(UiActivate)], (w) => {
    if (keys.justPressed("Enter") || pad?.buttons.justPressed("South"))
      w.write(new UiActivate());
  });
  ```

  The system runs after focus moves and before the toggle consumer, so the
  synthetic click is seen the same frame. The decision is a pure
  `shouldActivateFocused` (unit-tested). Focus is now navigate + ring + activate.

- 74486d3: feat(ui): `:focused` and `:checked` .rss pseudo-classes driven by live state

  The `.rss` resolver already matched `:focused` / `:checked`, but nothing emitted
  them. `deriveStates` now adds `checked` for a checked `UiToggle` and `focused`
  for the `UiFocus.current` node, so state-driven styling works:

  ```css
  Toggle:checked {
    background-color: #3a6;
  }
  Button:focus {
    border-color: #fff;
  } /* a focus ring, no engine border code */
  ```

  `resolveUiStyles` gained an optional `focusedEntity` argument (defaults to none);
  the `ui-style` system soft-reads the `UiFocus` resource (present only when
  `UiFocusPlugin` is added), so the style pass runs unchanged without focus wired
  up. This is the focus-ring visual for the focus/navigation work — authored purely
  in `.rss`.

- d945661: feat(ui): focus + spatial navigation

  In-game UI depth Phase 2 (ADR-0163). Keyboard/gamepad focus for the UI: a
  `UiFocus` resource holds the single focused entity, a `Focusable` marker opts a
  node in, and a `UiNavigate` message moves focus — game code maps its input (Tab,
  arrows, d-pad, stick) to a direction, keeping the focus layer device-agnostic.

  ```ts
  app.addPlugin(new UiFocusPlugin());
  cmd.spawn(new UiNode(...), new Focusable());
  app.addSystem('update', [MessageWriter(UiNavigate)], (w) => {
    if (keys.justPressed('Tab')) w.write(new UiNavigate('next'));
    if (keys.justPressed('ArrowRight')) w.write(new UiNavigate('right'));
  });
  ```

  `'next'`/`'prev'` walk tab order (layout paint order); `'up'`/`'down'`/`'left'`/
  `'right'` pick the nearest neighbour by a distance-along-axis + perpendicular
  penalty (aligned beats skewed). The nav math is pure `tabNavigate` /
  `spatialNavigate` (unit-tested); focus pointing at a despawned node self-clears.
  Activating the focused widget + a focus ring are tracked follow-ups.

- b235ad3: feat(ui): grid item alignment (justify/align items + self)

  Phase 3b of grid layout (ADR-0167). Grid items can now be aligned within their
  cell instead of always stretching to fill it. `UiStyle` gains `justifyItems` /
  `justifySelf` (inline / horizontal axis); the existing `alignItems` / `alignSelf`
  now also drive the block / vertical axis for grid. Values `flex-start` /
  `center` / `flex-end` / `stretch` (default), with per-item `*-self` overriding the
  container default:

  ```css
  .grid {
    display: grid;
    justify-items: center;
    align-items: center;
  }
  .hero {
    justify-self: end;
    align-self: stretch;
  }
  ```

  A non-`stretch` axis places the item at its definite (or intrinsic) size at the
  start / middle / end of the cell; `stretch` fills the cell as before, so existing
  grids are unchanged. `.rss` authoring maps `justify-items` / `justify-self` (plus
  `align-items` / `align-self`) and normalizes the CSS grid keywords `start` / `end`
  to the engine's `flex-start` / `flex-end`. Layout + resolver unit-tested.

- 3fed624: feat(ui): grid-auto-flow: column + implicit auto-columns

  Phase 3f of grid layout (ADR-0167). Grid auto-placement can now fill **columns**
  first (top-to-bottom, then rightward) instead of rows. `UiStyle.gridAutoFlow:
'row' | 'column'` (default `'row'`) picks the direction, and
  `UiStyle.gridAutoColumns` (px) sizes implicit columns — the `'column'`-flow
  counterpart to `gridAutoRows`:

  ```css
  .strip {
    display: grid;
    grid-template-rows: 40px 40px;
    grid-auto-flow: column;
    grid-auto-columns: 50px;
  }
  ```

  Column flow is implemented by transposing onto the existing, tested row-major
  placer (via a new `gridTrackCount(fixed, items, flow)` + a `flow` arg on
  `placeGridItems`), so the row-flow path is untouched. `.rss` maps
  `grid-auto-flow` / `grid-auto-columns`. Layout + resolver unit-tested (column
  fill order, row-span under column flow, implicit auto-columns).

- acef8b7: feat(ui): grid auto-rows (implicit rows)

  Phase 3c of grid layout (ADR-0167). Grid items past the explicit
  `grid-template-rows` now flow into **implicit** rows instead of collapsing to
  zero size. `UiStyle.gridAutoRows` (a fixed pixel height, default `0` = no
  implicit rows) sizes them; the layout engine grows the row template to fit before
  resolving geometry:

  ```css
  /* two columns, items flow into as many 48px rows as needed */
  .list {
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-auto-rows: 48px;
  }
  ```

  The placement core is refactored around a shared `assignGridCells` (bounded for
  `placeGridItems`, unbounded for the new `gridRowCount`), so span-aware
  auto-placement drives both cell geometry and the implicit-row count. `.rss` maps
  `grid-auto-rows`. Existing grids (no `gridAutoRows`) are unchanged. Placement,
  row-count, and layout are unit-tested.

- ec8ac36: feat(ui): grid auto (content-sized) tracks — grid is now feature-complete

  Final piece of grid track sizing (ADR-0167): `auto` tracks size to their content.
  `grid-template-columns: auto 1fr` makes the first column shrink to its items'
  intrinsic width while `1fr` takes the rest. Because placement only needs track
  _counts_, the layout engine places items first, measures each `auto` track's
  single-span items (via the existing intrinsic-measure), substitutes the track to
  that pixel size, then resolves `fr` over the remainder — reusing the tested
  placement/geometry primitives (a new exported `assignGridCells` exposes the
  assignments). The path is gated on the presence of an `auto` track, so grids
  without one are unchanged.

  With this, CSS Grid covers the full common feature set: `px`/`fr`/`auto`/`minmax`
  tracks, spanning, explicit line placement, implicit auto-rows/columns, row/column
  auto-flow, item alignment, and content distribution. (Multi-span `auto`
  contributions are a documented follow-up.) Unit + end-to-end tested.

- ffc6fce: feat(ui): grid content distribution (justify-content / align-content)

  Phase 3e of grid layout (ADR-0167). When a grid's tracks don't fill the container
  (e.g. a fixed-cell board smaller than its box), the whole track block can now be
  positioned: `justify-content` distributes it on the column axis, the new
  `UiStyle.alignContent` on the row axis. `start` / `center` / `flex-end` are
  supported (a leading offset applied to every cell):

  ```css
  .board {
    display: grid;
    grid-template-columns: 40px 40px 40px;
    justify-content: center;
    align-content: center;
  }
  ```

  `.rss` maps `align-content`. The `space-*` modes (track-level space distribution)
  fall back to start for now — a follow-up. Layout + resolver unit-tested.

- 4915bd4: feat(ui): grid content distribution space-between / around / evenly

  Completes grid content distribution (ADR-0167): `justify-content` /
  `align-content` now honor the `space-between` / `space-around` / `space-evenly`
  modes, not just `start` / `center` / `end`. When a grid's tracks don't fill the
  container, the leftover is distributed as a uniformly-widened inter-track gap
  (plus a leading offset for around / evenly):

  ```css
  .toolbar {
    display: grid;
    grid-template-columns: 20px 20px 20px;
    justify-content: space-between;
  }
  ```

  Implemented by folding all six modes into one `contentDistribution` helper that
  returns a leading offset + an effective gap, reusing the existing gap/offset
  placement path (no per-cell-index bookkeeping). Only bites when tracks don't fill
  the container (fr tracks fill it → no-op). Unit-tested (space-between + evenly
  spacing); start/center/end unchanged.

- f4b29a8: feat(ui): grid explicit line placement (grid-column / grid-row lines)

  Phase 3d of grid layout (ADR-0167). Grid items can now be placed at explicit grid
  lines instead of only auto-flowing. `UiStyle` gains `gridColumnStart` /
  `gridRowStart` (1-based lines, `0` = auto); when both are set the item is placed
  at that cell and auto items flow around it. The placement core is a two-pass
  `assignGridCells` (explicit items reserved first — they may overlap, per CSS —
  then sparse auto-flow); explicit rows count toward `gridRowCount` so auto-rows can
  hold them.

  `.rss` `grid-column` / `grid-row` now parse the full CSS line syntax via a new
  `gridLine` helper:

  ```css
  .hero {
    grid-column: 1 / 3;
    grid-row: 2 / span 2;
  } /* start line 1, span 2; start row 2, span 2 */
  .side {
    grid-column: 3;
  } /* explicit line 3, span 1 */
  ```

  **Behavior change:** a bare number (`grid-row: 3`) is now an explicit **line**
  (span 1), matching CSS — previously it was misread as a span. Use `span N` for a
  span. Layout + resolver unit-tested.

- 225be77: feat(ui): CSS grid layout core (track sizing + cell geometry)

  Phase 1 of grid layout (ADR-0167): the pure track-sizing + cell-geometry
  algorithm behind the `LayoutEngine` seam. `GridTrack` is `{ kind: 'px' }` or
  `{ kind: 'fr' }`; `resolveGridTracks(tracks, available, gap)` reserves fixed
  tracks + gaps then splits the leftover among `fr` tracks by fraction (clamped);
  `computeGridLayout(spec, available)` resolves column + row tracks and returns each
  cell's `LayoutRect`, row-major:

  ```ts
  computeGridLayout(
    {
      columns: [
        { kind: "px", value: 50 },
        { kind: "fr", value: 1 },
      ],
      rows: [{ kind: "fr", value: 1 }],
      columnGap: 10,
    },
    { width: 210, height: 100 }
  ); // → columnSizes [50, 150], one cell rect per grid cell
  ```

  Pure and unit-tested. Wiring it into `UiStyle` (`display: grid` +
  `grid-template-*`) and the layout-engine tree (placing children into cells),
  plus `auto`/`minmax`/placement/alignment, are tracked follow-up phases.

- 39213b7: feat(ui): display:grid layout integration

  Phase 2 of grid layout (ADR-0167). `UiStyle` gains `display: 'flex' | 'grid'` and
  `gridTemplateColumns` / `gridTemplateRows` (CSS-syntax strings, e.g. `"1fr 2fr
40px"`, parsed by `parseGridTemplate`; `gap` applies to both axes). The
  `FlexLayoutEngine` now branches on `display: 'grid'`: it computes the grid for the
  node's content box and lays each in-flow child into its cell, row-major, stretched
  to fill:

  ```ts
  new UiNode({
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gridTemplateRows: "1fr 1fr",
    gap: 8,
  });
  // its four children tile the content box in a 2×2 grid
  ```

  Grid fields reflect as plain strings/enum, so they round-trip. Children past the
  last cell get a zero-size rect for now (grid auto-rows are a later phase), and
  `.rss` grid authoring + explicit placement / `auto` / `minmax` / alignment are
  tracked follow-ups.

- b6ed9fc: feat(ui): grid minmax(px, fr) track sizing

  Phase 3h of grid layout (ADR-0167). Grid tracks can now be `minmax(<px>, <px|fr>)`
  — a track sized at least the given pixel floor. `minmax(120px, 1fr)` grows like a
  `1fr` track but never shrinks below `120px` (the CSS floored-`fr` algorithm:
  tracks whose fair share would starve are frozen at their min and the rest
  re-split); `minmax(px, px)` takes its min. Authored via the existing template
  strings — no new style fields:

  ```css
  .responsive {
    display: grid;
    grid-template-columns: minmax(120px, 1fr) 1fr;
  }
  ```

  `parseGridTemplate` keeps `minmax(...)` whole (even with the inner comma space)
  and `resolveGridTracks` runs the iterative floor resolution; plain `px` / `fr`
  behavior is unchanged. Content-sized `auto` tracks remain a follow-up (they need
  child intrinsic measurement). Unit-tested + end-to-end layout test.

- 10704c3: feat(ui): author CSS grid from `.rss`

  Phase 2b of grid layout (ADR-0167). The `.rss` style resolver now maps
  `display: grid`, `grid-template-columns`, and `grid-template-rows`, so a grid is
  authored from a stylesheet, not just `UiNode` init:

  ```css
  .inventory {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    grid-template-rows: 64px 64px;
    gap: 8px;
  }
  ```

  Template values are kept as CSS strings and parsed at layout time, so this needed
  no new reflection. Grid is now usable end to end (core → layout → authoring);
  explicit placement, `auto`/`minmax`, alignment, and auto-rows remain follow-ups.

- 1b958a7: feat(ui): grid item spanning + auto-placement

  Phase 3a of grid layout (ADR-0167). Grid items can span multiple tracks and are
  auto-placed by a CSS-style sparse algorithm. `placeGridItems(tracks, items)`
  walks cells row-major and drops each item at the first free top-left cell where
  its `colSpan × rowSpan` block fits, marking those cells occupied so later items
  flow past. `UiStyle` gains `gridColumnSpan` / `gridRowSpan`, authored from `.rss`
  via `grid-column` / `grid-row` (`span N` or a bare number):

  ```css
  .hero {
    grid-column: span 2;
    grid-row: span 2;
  }
  ```

  The layout engine now places grid children through `placeGridItems`, so a spanned
  child covers its block and subsequent children fill the remaining cells. Explicit
  line placement (`1 / 3`), `auto`/`minmax` tracks, alignment, and auto-rows remain
  follow-ups.

- e7e05d3: feat(ui): image widget — textured UI quads (`UiImage`)

  Adds the `image` minimal widget: draw a texture into a UI node's box.

  - New `UiImage` component (reflection-registered: image `Handle<Image>` + `tint`
    Vec4 + source `uv` sub-rect). A node may carry both a background color and a
    `UiImage` (the image draws over the fill).
  - A screen-space textured render path mirroring the MSDF text pipeline:
    `UiImagePipeline` (per-source-texture bind-group cache, `unorm8x4` tint),
    `prepareUiImages` (batch `UiImage` nodes by texture, map to clip space),
    and `makeUiImagePassNode` — wired into `UiRenderPlugin` ordered
    quad → **image** → text (images composite over backgrounds, under labels).

  Additive; headless-safe (no surface → the prepare/pass no-op). Unit-tested
  (`packUiImage`) + benched (`ui-image-pack`). Verified in a real browser via the
  sample-game export: a 2×2 procedural checkerboard chip drew (`imageInstances === 1`),
  which a solid-color quad cannot produce.

- ecbe853: feat(ui): pointer interaction — picking, hover/press state, click events (UI phase 4a)

  UI nodes can now respond to the pointer, the foundation for buttons and menus.

  - `Interactable` — an authored marker opting a node into picking (auto-attaches
    `UiNode` + `ComputedLayout` + `UiInteraction`), reflection-registered.
  - `UiInteraction` — the node's derived `'none' | 'hovered' | 'pressed'` state
    (not serialized), updated each frame.
  - `UiClicked` — a message emitted when a primary-button press begins on a node
    and releases over the same node.
  - `pickTopmost` — hit-tests a point against interactive nodes, returning the
    front-most by depth-first paint order. `updateUiInteraction` resolves one
    frame of hover/press state + click emission (pure but for two callbacks).
  - `UiInteractionPlugin` — runs the picking system in `preUpdate` after the input
    update; reads `CursorPosition` + `MouseButtonInput` from `@retro-engine/input`
    (a new `ui` dependency). Headless/no-input → no-op. `UiPointer` tracks the hot
    and pressed nodes across frames.

  Verified end-to-end: the `sample-game` export shows a centered "CLICK ME" button
  that tints on hover/press and increments a "CLICKS: N" label — driven through the
  real input backend in a browser (Playwright). Unit tests cover pick + the full
  hover/press/click state machine (69 UI tests); a `ui-picking` bench joins the
  suite. Widgets (button/slider components, focus, spatial nav) build on this.

- 9144b60: feat(ui): UiNode/ComputedLayout components + UiPlugin layout system (phase 1b)

  Drives the flexbox engine from the ECS:

  - `UiNode` — the authored `UiStyle`, reflection-registered so it round-trips
    through a saved scene (auto (`undefined`) dimensions and no-limit max-sizes are
    omitted on encode and restored on load). Auto-attaches `ComputedLayout`.
  - `ComputedLayout` — the computed **absolute** (screen-space) box, written each
    pass; derived, deliberately not serialized.
  - `UiPlugin` — inserts `UiViewport` (root available size) and `UiLayout` (the
    swappable engine), and runs a `postUpdate` `ui-layout` system that mirrors the
    `Parent`/`Children` hierarchy into a `LayoutNode` tree, computes it, and writes
    each entity's `ComputedLayout` with accumulated absolute coordinates.

  A `UiNode` whose parent is not a `UiNode` (or has none) is a UI root sized
  against the viewport. Verified on a bare ECS `World` (no renderer) plus a
  reflection round-trip of every authored style field. Rendering the computed boxes
  through the 2D pipeline is the next phase.

- 964a5ea: feat(ui): screen-space UI overlay rendering — background quads (UI phase 2a)

  In-game UI now draws on screen. A `UiRenderPlugin` composites `UiNode`
  backgrounds over the rendered scene through a once-per-frame screen-space overlay
  pass (ADR-0154).

  - `UiStyle.backgroundColor` (linear RGBA `Vec4`, optional) — a paint property
    layout ignores and the renderer fills; reflection-registered on `UiNode`.
  - `UiPipeline` — an alpha-blended, camera-free quad pipeline (unit quad +
    per-instance clip rect + `unorm8x4` color; no bind groups — the rect is mapped
    to clip space on the CPU). `computeClipRect` / `packUiQuad` / `packUiColor`.
  - `UiPassNode` (`UiPassLabel`) — a top-level render-graph node registered after
    the camera driver; owns its encoder and draws to the swapchain with
    `loadOp: 'load'` so UI composites over the scene, once per frame.
  - `UiRenderPlugin` — inserts the pipeline, syncs `UiViewport` to the canvas
    logical size, runs the prepare pass (maps `ComputedLayout` → clip-space
    instances, painted in the layout's depth-first `order` so children draw over
    their parent), and registers the node in `finish`. Headless-safe (no surface →
    no-op).
  - `ComputedLayout.order` — depth-first paint order stamped by the layout pass.

  `@retro-engine/ui` now depends on `@retro-engine/math` (colors) and
  `@retro-engine/renderer-core` (HAL types), per ADR-0150.

  Verified end-to-end: the `sample-game` web export renders a nested flex HUD panel
  (translucent panel + orange title bar + green content) correctly composited over
  the scene in a real browser (Playwright). Borders, corner radius, in-UI text, and
  z-index are subsequent sub-phases.

- 1ff9833: feat(ui): `.rss` custom properties — `--vars`, `var()`, and a runtime theme

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

- 4e3973b: feat(ui): `.rss` custom-property inheritance (cascade down the UI tree)

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

- f78f927: feat(ui): .rss (USS-subset) stylesheet parser + style resolution (phase 3)

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

- 7116256: feat(ui): `.rss` runtime style wiring — apply a parsed stylesheet to the live UI tree

  The `.rss` (USS-subset) parser + cascade already existed; this wires it into the
  running UI so a stylesheet actually styles nodes each frame ("Retro CSS").

  - `resolveUiStyle` now maps the **paint** properties too — `background-color`,
    `border-color`, `border-width`, and the `border` shorthand — via a new
    `parseColor` (hex `#rgb`/`#rgba`/`#rrggbb`/`#rrggbbaa`, `rgb()`/`rgba()`, and
    named colors → an RGBA `Vec4` in `[0,1]`, stored as authored, matching a
    hand-set `UiStyle.backgroundColor`).
  - New `UiStyleSheet` resource holds the active parsed rules; `setUiStyleSheet(app,
rss)` parses and installs them.
  - New `UiClass` component (reflection-registered: `classes` / `name` / `type`)
    gives a node its selector identity. Nodes carrying one are styled from the sheet.
  - `UiPlugin` runs a `postUpdate` `'ui-style'` system (before `'ui-layout'`) that
    resolves each `UiClass` node's `UiStyle` from the sheet every frame, deriving
    pseudo-class states — `hovered`/`pressed` from `UiInteraction`, `disabled` from
    the `Disabled` marker — so hover/press/disable reflow the same frame.

  Additive: nodes without a `UiClass` keep their authored `UiNode.style` untouched.
  Bench added (`rss-style`). Verified in a real browser via the sample-game export:
  `.chip` → blue, `.chip.alt` (compound) → orange, `.chip:hovered` → red on live hover.

- ae93142: feat(ui): UiSlider (draggable value) widget

  Second widget of in-game UI depth Phase 1. `UiSlider` holds a scalar in
  `[min, max]` that tracks the pointer's horizontal position across the node's
  track while the slider is held, emitting `UiSliderChanged` on change:

  ```ts
  cmd.spawn(new UiSlider({ min: 0, max: 1, value: 0.5 }));
  app.addSystem("update", [MessageReader(UiSliderChanged)], (events) => {
    for (const s of events) audio.setBusVolume("music", s.value);
  });
  ```

  The drag is driven off `UiPointer.pressed` (the press-origin node), so it works
  whether you grab the track or the thumb. The mapping is a pure
  `computeSliderValue(cursorX, trackX, trackWidth, min, max)` — unit-tested for
  edge clamping, midpoint, non-zero min, and an unlaid-out (zero-width) track. The
  widget owns the value; visual fill is composed by the game.

- 13fa3c1: feat(ui): text-input widget (UiTextInput)

  An editable single-line text field, the biggest of the in-game-ui-depth widgets.
  `UiTextInput` (reflection-registered; auto-attaches `Interactable` + `Focusable`)
  holds the `value` + caret; `UiTextInputPlugin` focuses it on click and, while
  focused, folds the frame's typed characters (`@retro-engine/input`'s
  `ReceivedCharacters`) and caret keys (Backspace / Delete / arrows / Home / End)
  into the value, mirroring it into the node's `UiText` for rendering (a
  `placeholder` shows while empty). Emits `UiTextChanged` on value changes.

  ```ts
  app.addPlugin(new UiTextInputPlugin());
  cmd.spawn(
    new UiTextInput({ placeholder: "name…", maxLength: 16 }),
    new UiText({ font })
  );
  ```

  The editing logic is pure and unit-tested — `insertText`, `applyEditKey`, and
  `applyTextInputFrame` (caret keys apply before this frame's typed text). Caret
  rendering and key-repeat are follow-ups; multi-keystroke IME is out of scope
  (tracked on the input side).

- a7cc684: feat(ui): UiText content + measureText bridge into the flex layout pass

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

- 7199980: feat(ui): in-UI text rendering via a screen-space MSDF overlay (UI phase 2b)

  `UiText` nodes now draw their glyphs on screen, positioned within the node's
  content box by the flex layout, composited over UI backgrounds.

  - `UiText.color` (linear RGBA `Vec4`, default white), reflection-registered.
  - `UiTextPipeline` — a screen-space MSDF glyph pipeline reusing the engine's
    glyph layout (`Font.layout`) and font atlas: unit quad + per-instance clip
    rect + atlas UV + `unitRange` + `unorm8x4` color; median-of-RGB coverage with
    `fwidth`-based AA (crisp at any size). Per-atlas bind-group cache.
  - `prepareUiText` — lays out each `UiText`, places glyphs at the node's content
    origin, maps them to clip space, and packs them grouped by atlas (one draw
    batch per font). `packUiGlyph` / `computeClipRect`.
  - `UiTextPassNode` — a second overlay render-graph node ordered after the UI
    quad pass, drawing the glyph batches to the swapchain with `loadOp: 'load'`.
  - `UiRenderPlugin` registers the text pipeline + prepare system + pass node.
    `Fonts` (from `TextPlugin`) is optional — no font store, no UI text drawn.

  Verified end-to-end: the `sample-game` export renders a HUD panel with labels
  ("STATUS", "HP 100 MP 42") crisply inside their colored boxes in a real browser
  (Playwright). 61 UI tests + a `ui-text-pack` bench. Per-line alignment, richer
  text styling, and true interleaved z-ordering of text vs. later panels remain.

- 02a81eb: feat(ui): UiToggle (checkbox) widget

  First widget of in-game UI depth Phase 1. `UiToggle` is a two-state
  toggle/checkbox that flips its `checked` state each time the node is clicked,
  emits a `UiToggled` message, and drives its `backgroundColor` from the state — all
  on top of the existing `Interactable` / `UiClicked` interaction foundation.

  ```ts
  cmd.spawn(new UiToggle({ checked: true }));
  app.addSystem("update", [MessageReader(UiToggled)], (events) => {
    for (const t of events) applyMuteSetting(t.checked);
  });
  ```

  The flip logic is exposed as a pure `applyToggleClicks` (unit-tested: flips on
  click, ignores non-toggles and `Disabled` nodes, batches multiple clicks); the
  plugin wires it after the picking system so this frame's clicks are seen.

### Patch Changes

- 597b913: feat(engine): windowed frame-time stats + 1%-low FPS in diagnostics

  `DiagnosticsStore` now tracks a rolling window of recent frame times and exposes
  `minFrameTimeMs` / `maxFrameTimeMs` / `avgFrameTimeMs` and `onePercentLowFps` —
  the standard "1% low" stutter metric (`1000 / p99` frame time) — alongside the
  existing smoothed FPS. Backed by a new `FrameTimeWindow` (O(1) ring buffer,
  default 120 frames ≈ 2s) + a pure `frameTimeStats(samples)`.

  `@retro-engine/ui`'s diagnostics overlay `formatDiagnostics` appends the readout
  once the window has samples, e.g. `FPS 60 (low 42)  16.7ms  ents 42  assets 12`.
  Unit-tested + benched (the per-frame window sort).

- 23477f9: feat(input): surface OS key auto-repeat on ButtonInput

  `ButtonInput` now tracks a per-frame **repeated** set fed from the DOM's
  auto-repeat `keydown` events (which already carried a `repeat` flag): `press(input,
repeat)` routes a repeat into `repeated(input)` without re-firing `justPressed`.
  `justPressedOrRepeated(input)` is the "act now, then repeat while held" test —
  useful for held-direction menu scrolling and text editing. Using the OS repeat
  cadence means no engine-side repeat timer and it honors the user's system key-
  repeat settings.

  `@retro-engine/ui`'s `UiTextInput` now uses it, so holding Backspace / Delete /
  an arrow repeats the edit at the OS cadence (typed characters already repeated via
  `ReceivedCharacters`). Unit-tested.

- Updated dependencies [45c51aa]
- Updated dependencies [1b9b7f5]
- Updated dependencies [51e8516]
- Updated dependencies [7d40c1a]
- Updated dependencies [937f2cb]
- Updated dependencies [b315044]
- Updated dependencies [d5424c3]
- Updated dependencies [e0c4984]
- Updated dependencies [15617ff]
- Updated dependencies [ab6e7b9]
- Updated dependencies [1b66f35]
- Updated dependencies [0baa8a9]
- Updated dependencies [7142f6f]
- Updated dependencies [2c27d90]
- Updated dependencies [7e26e59]
- Updated dependencies [e73d32e]
- Updated dependencies [9c36012]
- Updated dependencies [12eb41d]
- Updated dependencies [773fabd]
- Updated dependencies [afc904c]
- Updated dependencies [3b3cf7f]
- Updated dependencies [2c27d90]
- Updated dependencies [a9837c6]
- Updated dependencies [f8079c6]
- Updated dependencies [e8c703e]
- Updated dependencies [8029403]
- Updated dependencies [2324f9f]
- Updated dependencies [294c161]
- Updated dependencies [597b913]
- Updated dependencies [6e1d04c]
- Updated dependencies [5ea3e80]
- Updated dependencies [2f22822]
- Updated dependencies [62e382e]
- Updated dependencies [5d7a21a]
- Updated dependencies [8d36fd7]
- Updated dependencies [3b04954]
- Updated dependencies [9e2aaf5]
- Updated dependencies [1280e03]
- Updated dependencies [fdde82f]
- Updated dependencies [9d41f83]
- Updated dependencies [056bfc9]
- Updated dependencies [1cdff13]
- Updated dependencies [1c76eef]
- Updated dependencies [d8b7fc2]
- Updated dependencies [5ea3e80]
- Updated dependencies [68963c6]
- Updated dependencies [be766a4]
- Updated dependencies [bc7640e]
- Updated dependencies [cad5613]
- Updated dependencies [4741039]
- Updated dependencies [4ca7beb]
- Updated dependencies [0bc6ca5]
- Updated dependencies [e163274]
- Updated dependencies [5317052]
- Updated dependencies [5599db7]
- Updated dependencies [5988cb6]
- Updated dependencies [a055d25]
- Updated dependencies [2a7a18b]
- Updated dependencies [da51d57]
- Updated dependencies [c2732c5]
- Updated dependencies [dcc84d2]
- Updated dependencies [fad8a5e]
- Updated dependencies [1c4a0fe]
- Updated dependencies [c4bf47a]
- Updated dependencies [7812b83]
- Updated dependencies [8e4574a]
- Updated dependencies [be4aad1]
- Updated dependencies [0eca147]
- Updated dependencies [88d0fc5]
- Updated dependencies [a1350d0]
- Updated dependencies [b3db22b]
- Updated dependencies [23477f9]
- Updated dependencies [b3d33a0]
- Updated dependencies [087b196]
- Updated dependencies [9bf0721]
- Updated dependencies [01070b1]
- Updated dependencies [b788a60]
- Updated dependencies [a3b6d83]
- Updated dependencies [43cae6c]
- Updated dependencies [90a56e2]
- Updated dependencies [88d3ca3]
- Updated dependencies [68ce298]
- Updated dependencies [b5e3322]
- Updated dependencies [10bda28]
- Updated dependencies [ca1cafa]
- Updated dependencies [e97fdd2]
- Updated dependencies [3db9d87]
- Updated dependencies [0c7b778]
- Updated dependencies [781aa88]
- Updated dependencies [7142f6f]
- Updated dependencies [eb3c452]
- Updated dependencies [e6728cc]
- Updated dependencies [8029403]
- Updated dependencies [d63d0f9]
- Updated dependencies [c049410]
- Updated dependencies [707714f]
- Updated dependencies [3658119]
- Updated dependencies [ac35dac]
- Updated dependencies [3280a8e]
- Updated dependencies [62effe1]
- Updated dependencies [ca677c6]
- Updated dependencies [abbd55c]
- Updated dependencies [67e8513]
- Updated dependencies [8ac39a9]
- Updated dependencies [92d6c91]
- Updated dependencies [f8079c6]
- Updated dependencies [75a1a8a]
- Updated dependencies [e6728cc]
- Updated dependencies [a896a3b]
- Updated dependencies [5be634a]
- Updated dependencies [690c811]
- Updated dependencies [da1f0eb]
- Updated dependencies [056bfc9]
- Updated dependencies [7dc7bca]
- Updated dependencies [5c33631]
- Updated dependencies [fa2678b]
- Updated dependencies [67e8513]
- Updated dependencies [836a7ab]
- Updated dependencies [ea56975]
- Updated dependencies [6fbb29d]
- Updated dependencies [d25c7aa]
- Updated dependencies [4015d71]
- Updated dependencies [82ecdec]
- Updated dependencies [bcef667]
- Updated dependencies [c26f7a3]
- Updated dependencies [7b8eeea]
- Updated dependencies [8a6fb8f]
- Updated dependencies [9712180]
- Updated dependencies [bc24cd2]
- Updated dependencies [f45c5f0]
- Updated dependencies [824b04f]
- Updated dependencies [47372a5]
- Updated dependencies [73fdef4]
- Updated dependencies [88c4629]
- Updated dependencies [93f4053]
- Updated dependencies [ba77627]
- Updated dependencies [f2f082b]
- Updated dependencies [641b263]
- Updated dependencies [7812b83]
- Updated dependencies [48686b4]
- Updated dependencies [f0584f2]
- Updated dependencies [bc634ae]
- Updated dependencies [f95bac1]
- Updated dependencies [7dddd6f]
- Updated dependencies [a0fb8d4]
- Updated dependencies [59d37c2]
- Updated dependencies [7142f6f]
- Updated dependencies [acae153]
- Updated dependencies [8934a75]
- Updated dependencies [f55bffb]
- Updated dependencies [b1a1e01]
- Updated dependencies [5b52805]
- Updated dependencies [dd3de07]
- Updated dependencies [d8c0bda]
- Updated dependencies [b10dc50]
- Updated dependencies [05d2bb6]
- Updated dependencies [0f8701d]
- Updated dependencies [7f40ed1]
- Updated dependencies [591fdef]
- Updated dependencies [42d7275]
- Updated dependencies [b2a610d]
- Updated dependencies [8259a32]
- Updated dependencies [c6163cb]
- Updated dependencies [2beee52]
- Updated dependencies [5cf81f9]
- Updated dependencies [ce20898]
- Updated dependencies [823e5cd]
  - @retro-engine/engine@0.1.0
  - @retro-engine/input@0.1.0
  - @retro-engine/renderer-core@0.1.0
  - @retro-engine/reflect@0.1.0
  - @retro-engine/ecs@0.1.0
  - @retro-engine/math@0.1.0
