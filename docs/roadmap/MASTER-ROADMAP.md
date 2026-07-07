# Master Roadmap

- **Created:** 2026-07-05
- **Status:** Living (the single prioritized checklist across the whole engine; never "done")

The one place that answers *"what do we build next, and in what order?"* across **engine, renderer,
editor, and platform**. It is an **overlay/index**: where a work item already has a `backlog/` or
`roadmap/` file, this links to it rather than restating it; new gaps are first-class here until they
get their own file.

For *what already exists*, see [`../reference/`](../reference/README.md) (the "second brain"). For
*why* something was decided, grep [`../adr/`](../adr).

---

## How to use this (with `/loop`)

1. **Work top-down by priority.** Finish **P0** before **P1**, **P1** before **P2**. Within a tier,
   order is a suggestion — pick the item whose dependencies are met.
2. **One item at a time.** Each item is a checkbox. When you start it, flip it to in-progress in your
   working notes and (per CLAUDE.md §8) create `../backlog/<slug>.md` from the template if it doesn't
   already have a home; link it back here.
3. **Definition of done is the item's AC.** P0 items carry acceptance criteria inline. P1/P2 items
   carry a scope line now; fill in AC when the item is promoted.
4. **"Done" needs the user's explicit say-so** (CLAUDE.md §3). Then check the box here, flip the
   `../reference/` status tag in the same change, and delete the backlog/bug file.
5. **Keep feeding it.** New ideas append to the right tier/category. This file is meant to grow.

## Priority legend

Reasons rest on **impact / dependency / cost**, never genre (CLAUDE.md §12 — "retro" is an aesthetic,
not a capability ceiling).

- **P0 — Critical**: blocks shipping a complete game, or a stability bug that freezes the engine.
- **P1 — Important**: real depth, quality, platform reach, or authoring workflow — high value, not
  blocking a first game.
- **P2 — Nice-to-have**: fidelity/polish/advanced capability; deferred for sequencing/cost or because
  it depends on P0/P1 infrastructure.

## Status legend (mirrors `../reference/`)

`✅ done · 🟡 partial · 🔩 stub · ❌ absent` — the current state of the thing this item builds toward.

## North star

The renderer and ECS are deep. Input, audio, and physics now exist (`@retro-engine/input` ✅,
`@retro-engine/audio` ✅, `@retro-engine/physics-core`/`-rapier` ✅), but you still can't ship a
complete game: no engine text, in-game UI, or game export yet. **P0 is exactly that shippable-game
foundation.**

---

# P0 — Critical

## Engine

- [x] **Input system** — ✅ `@retro-engine/input` (ADR-0144/0145/0146). **Phases 1–4 shipped**
      (keyboard + mouse + action map + gamepad + touch): `ButtonInput<T>` + `Axis<T>`, `KeyboardInput`/
      `MouseButtonInput`/`MouseMotion`/`MouseScroll`/`CursorPosition`, `InputBackend` HAL
      (`DomInputBackend` + headless), component-based `ActionMap` (reflection-registered) + derived
      `ActionState`, poll-based `Gamepads` (`GamepadSource` + standard-mapping + dead zones), `Touches`
      resource, playground `?mode=input` sample.
      _AC:_ pressed / just-pressed / just-released ✅; mouse buttons/motion/wheel/position ✅;
      gamepad ✅; touch ✅; action-map + reflection ✅; headless-safe ✅; a sample moves an entity ✅.
      Optional Phase 5 (studio binding editor) + the two follow-ups below are P1.
      _Links:_ [input-system.md](input-system.md)
- [x] **Audio (core)** — ✅ `@retro-engine/audio` (ADR-0147). **Phases 1–2 shipped:** `AudioBackend` HAL +
      `WebAudioBackend`/`NullAudioBackend`; `AudioClip` importer + asset kind (.wav/.ogg/.mp3) with `.meta`;
      `Audio` resource (play/stop/volume/pitch/loop, one-shot + looping); component-based `AudioSource` +
      `AudioListener` (reflection-registered) + `AudioVoices` runtime + `reconcileAudio` playback system
      (playOnAdd, despawnOnEnd, live volume sync); `AudioPlugin` (opt-in, headless-safe, autoplay-resume);
      playground `?mode=audio` sample plays entity-driven SFX + music.
      _AC:_ AudioClip importer/kind/.meta ✅; one-shot + looping ✅; `AudioSource`/`AudioListener` ✅;
      reflection schemas ✅; entity-driven SFX+music sample ✅. (Mixer buses → P1.)
      _Links:_ [audio.md](audio.md)
- [x] **Physics** — ✅ `@retro-engine/physics-core` + `@retro-engine/physics-rapier` (ADR-0148).
      Contract + Avian-shaped `2d`/`3d` components (reflection-registered) + `Gravity`/`Physics` resources +
      fixed-timestep Sync→Step→Writeback `PhysicsPlugin`; the **Rapier 2D + 3D backend** (`createRapierBackend`
      over `rapier2d/3d-compat` — entity↔body maps, async wasm gate, gravity/gravity-scale/external-force/
      kinematic, raycast); **collision events** → ECS (`CollisionEvent` message); a kinematic **character
      controller** (collide-and-slide, grounded); and **joints** (`Joint2d`/`Joint3d`: fixed/revolute/
      prismatic/spherical). All verified by deterministic headless tests. Playground `?mode=physics` demo:
      boxes fall + stack, Space drops more, and a character walks among them.
      _AC:_ contract + components + reflection ✅; fixed-timestep bridge ✅; rapier 2D+3D + real sim ✅;
      falling demo ✅; ECS collision events ✅; character controller ✅; joints ✅. (Studio integration → P1/P2.)
      _Links:_ [physics.md](physics.md)
- [ ] **In-game UI (core) — "Retro CSS"** — 🟡 `@retro-engine/ui`; **Phases 1a+1b shipped**: the pure-TS
      **flexbox `LayoutEngine`** (`FlexLayoutEngine` — §9.7 grow/shrink with min/max freezing, justify/align,
      gap, padding/margin, absolute insets) behind a swappable interface + text-measure callback, plus
      `UiNode` (reflection-registered) / `ComputedLayout` (derived) + a `UiPlugin` `postUpdate` layout system
      that mirrors `Parent`/`Children` → runs the engine → writes absolute geometry; plus the **`.rss`
      (USS-subset) parser + style resolution** (`parseRss`/`resolveUiStyle` — compound selectors, specificity
      cascade, declaration→`UiStyle` mapping, verified end-to-end against the layout engine). Headless. Plus
      **Phase 1c: `UiText` content component + `makeTextMeasure`** — the ADR-0149 `measureText` bridge, so a
      leaf text node sizes to its text through flexbox. Plus **Phase 2a+2b: screen-space rendering** —
      `UiRenderPlugin` draws `backgroundColor` quads (`UiPassNode`) **and in-UI text** (`UiText` glyphs via a
      screen-space MSDF pipeline, `UiTextPassNode`) through once-per-frame overlay passes (`loadOp:'load'`),
      verified in a real browser (a HUD panel with colored boxes + crisp labels in the sample-game export,
      ADR-0154). Plus **Phase 4a: pointer interaction** — `Interactable`/`UiInteraction`/`UiClicked` +
      picking (`pickTopmost`) + `UiInteractionPlugin` (reads `@retro-engine/input`), verified in a real
      browser (a clickable button + live click counter in the sample-game export). Plus **Phase 4b: the
      `UiButton` widget** (built-in hover/press/disabled tinting) + `Disabled` marker + `setUiBackground`,
      verified via a working 3-button main menu (one disabled) in the sample-game export. Plus **Phase 2c:
      node borders** (`UiStyle.borderWidth`/`borderColor` → inset edge quads, verified via outlined panel +
      buttons). Plus **Phase 3b: `.rss` runtime wiring** — a `UiStyleSheet` resource (`setUiStyleSheet`) +
      `UiClass` component (selector identity) + a `postUpdate` `'ui-style'` system that resolves every
      `UiClass` node's `UiStyle` from the sheet each frame (paint props now mapped via a CSS `parseColor`),
      deriving `:hovered`/`:pressed`/`:disabled` states live; verified in a browser (sample-game export:
      `.chip` blue, `.chip.alt` compound → orange, `.chip:hovered` → red on live hover). Plus **Phase 3c:
      `.rss` custom properties** — `--vars` + `var(--name, fallback)` (`collectThemeVars`/`substituteVars`)
      resolved against a `UiTheme` resource (`setUiThemeVars`, runtime re-theming); `border` shorthand now
      handles functional colors; verified in a browser (chips fill via `var(--accent)`, and a runtime
      `--accent` override recolors them live). Remaining: UI **corner radius** + z-index/clipping + per-line
      text alignment; `.rss` combinators + per-node scoped vars/inheritance + inline overrides + a `.rss`
      asset kind; **more widgets** (toggle/slider/text-input) + focus/spatial nav (4c). Plus **image
      widget** ✅ — `UiImage` (image handle + tint + UV) + a screen-space textured pipeline mirroring the
      MSDF text path (`UiImagePipeline`/`prepareUiImages`/`makeUiImagePassNode`, ordered quad → image →
      text); verified in a browser (a 2×2 checkerboard chip drew, `imageInstances === 1`). Plus **`.rss`
      custom-property inheritance** ✅ — resolution walks `Parent`/`Children`: `*`/`:root` vars are a global
      base, an element selector's `--vars` inherit down + override within its subtree, and the `UiTheme`
      override survives scoped vars; verified in a browser (a chip inside a `.themed` container inherits its
      green `--accent` while siblings stay global blue, and stays green after a runtime re-theme).
      **All acceptance criteria are now met** — ready to check off pending user confirmation (CLAUDE.md §3).
      (ADR-0150/0154.)
      _AC:_ `UiNode` + derived `ComputedLayout` (not serialized) reusing `Parent`/`Children`; a pure-TS
      **flexbox** `LayoutEngine` behind an interface, with a text-measure callback; a `.rss` (USS-subset)
      parser + style-resolution system matching type / `.class` / `#name` / **state-marker** selectors
      with cascade ✅ + inheritance ✅; pseudo-class markers (`Hovered`/`Focused`/`Pressed`/`Disabled`/`Checked`) ✅;
      `--vars` via a theme resource ✅; render through the 2D pipeline (quads + MSDF glyphs) ✅; minimal
      widgets (panel ✅ / label ✅ / button ✅ / image ✅); a HUD scene laid out with flex and styled by
      `.rss` ✅. (Grid, virtualized list/tree, data binding, spatial nav → P1.) Depends on **Text rendering**
      below. **All AC met** — ready to check off pending user confirmation (CLAUDE.md §3). Non-AC polish
      remaining (→ P1/P2): corner radius, z-index/clipping, `.rss` combinators + inline overrides + asset
      kind, more interactive widgets (toggle/slider/text-input), spatial nav.
      _Links:_ [ui-system.md](ui-system.md)

## Renderer

- [ ] **Engine text rendering (MSDF)** — 🟡 Phases 1–2c shipped under `packages/engine/src/text/`:
      `MsdfFont`/`parseMsdfFont`, `layoutText`/`measureText`, `Font` asset + `.font` loader, `Text2d`
      (reflection round-trips), full glyph render pipeline (shader + `TextPipeline`/`TextInstanceBuffer`/
      `packGlyphInstance` + `text-prepare`/`text-queue` through the transparent 2D phase), a built-in
      pure-JS SDF default font (`installDefaultFont`), and a `?mode=text` playground sample. Unit-tested +
      capturing-renderer integration + benched. **On-screen confirmation done** — the `sample-game` web
      export renders crisp MSDF text in a real browser (Playwright, see web-build-target.md). **`measureText`
      now wired into the UI layout measure callback** (`@retro-engine/ui` `UiText` + `makeTextMeasure`).
      World-space `Text` (3D) — **promoted (ADR-0155)**, render path **shipped**: **3a** (`packGlyphInstance3d`,
      unit-tested) + **3b** (the reflection-registered `Text` component + `text-3d.wgsl` + depth-specialized
      `Text3dPipeline` + `prepareText3d`/`queueText3d` into `ViewPhases3d.transparent`, drawn depth-tested by
      Core3d's `TransparentPass3d`). **Integration-verified** (`text3d-plugin.test.ts`: a `Text` under a
      `Camera3d` emits one `.transparent3d` instanced draw, 2 glyphs → instanceCount 2). **Browser
      pixel-verified** (playground `?mode=text3d`): crisp world-space MSDF text under a perspective camera,
      correctly occluded by a nearer cube — which exposed + fixed a latent engine bug (the 3D transparent
      pass used an invalid `depthReadOnly` + load/store combo, breaking the whole phase for its first
      consumer). Both `Text`/`Text2d` now render + are pixel-verified. **All AC met** — ready to check off
      pending user confirmation (CLAUDE.md §3). (Rich-text runs + a billboard flag are non-AC follow-ups.)
      Optional: true-MSDF atlas via `msdf-atlas-gen` (the `.font` importer already loads one).
      _AC:_ MSDF glyph atlas (generated via msdfgen, loaded as an asset) + runtime glyph-quad batching
      through the 2D pipeline; `Text`/`Text2d` components; font asset kind + `.meta`; layout
      (line-break/wrap/alignment); glyph metrics exposed to the UI layout measure callback; crisp at any
      scale/rotation; a sample draws multi-line styled text. (Required by in-game UI.)
      _Links:_ [text-rendering.md](text-rendering.md) · [ADR-0149](../adr/ADR-0149-engine-text-msdf.md) · folds into [ui-system.md](ui-system.md)

## Editor / Studio

- [ ] **Play mode (snapshot / restore / step)** — 🟡 `SimState` + **snapshot/restore core shipped**
      (`@retro-engine/editor-sdk`, ADR-0152): `captureSnapshot`/`restoreSnapshot` (World-level, renderer-free,
      excludes editor infra via a `keep` filter, returns the id-remap map) + `installPlayModeSnapshot`
      (capture on `onExit(Edit)`, restore on `onEnter(Edit)`). Gating policy formalized (user systems run
      only `inState(Play)`). **Now wired into the studio + MCP-verified** — `installPlayModeSnapshot` runs on
      the studio's play/stop; a Play→edit→Stop cycle reverts an authored field (Health 150→110) with the
      entity count unchanged (77→77, no glTF-rig duplication). Needed a **composition-aware capture fix**
      (`SerializeOptions.composition`) so restore doesn't re-instantiate glTF subtrees. Selection is cleared
      on restore. **Step shipped + MCP-verified** — `SimStep`/`installSimStep` + gate
      `inState(Play).or(simStepActive())`, wired to the toolbar Step button + `studio.step` MCP; advances
      gameplay exactly one frame while paused without leaving `Paused` (verified: a paused `Health` regen
      froze, then stepped +1/frame linearly). Remaining: true selection *survival* + inspector-during-play
      (+ a fixed-timestep follow-up, see play-mode.md).
      _AC:_ snapshot the authored scene on Play (serialize world) ✅, restore it exactly on Stop (no leaked
      play-time edits) ✅; **Step** advances exactly one frame while paused ✅; systems gate correctly by
      `SimState` ✅; inspector shows live values during play ❌.
      _Links:_ [play-mode.md](play-mode.md) · [`../backlog/studio-playmode-snapshot-restore.md`](../backlog/studio-playmode-snapshot-restore.md)

## Platform / Tooling

- [ ] **Export — Web target + `.rpak` foundation** — 🟡 `@retro-engine/build` + `@retro-engine/runtime-web`;
      **Phases 1–3 shipped**: the `.rpak` v1 format (`writeRpak` gzip+integrity, `RpakReader`,
      `RangeRpakReader` HTTP-Range streaming), the `ExportTarget`/`ExportRegistry` interface, the **web
      adapter** (`bundleUserCode`, `emitIndexHtml`, `WebExportTarget`), **and now the runtime host + CLI**:
      `@retro-engine/runtime-web` `bootWebGame` (canvas → WebGPU renderer → plugins → run, ADR-0153),
      `emitWebBoot` (generated boot entry the target bundles), `parseProjectDescriptor`
      (`@retro-engine/project`), and a `retro-build` CLI (`retro build --target web`). **In-browser run proof
      done** — `@retro-engine/sample-game` exports via the CLI and boots in a real browser (WebGPU init +
      crisp MSDF text + animating frame loop, Playwright-verified). **Asset packing phase A done** — the CLI
      scans `.meta` sidecars, packs a GUID-keyed `.rpak`, and emits `manifest.json`. **Runtime asset loading
      phase B done** — `RpakAssetSource` (`@retro-engine/runtime-web`, via a browser-safe
      `@retro-engine/build/rpak` subpath) + `bootWebGame({ assets })` fetch the manifest and bind a
      `.rpak`-backed source to the App's `AssetServer`. **Asset delivery A+B+C complete + browser-verified**:
      the sample export packs `credits.txt`, and at runtime it `loadByGuid`s it — the value streams from the
      `.rpak` over HTTP and is consumed by game code (`window.__game.credits` matches the file exactly; UI
      shows "CREDITS: LOADED"). Remaining before check-off: **studio "Build → Web" menu** (studio-side) +
      source maps / production polish. (ADR-0151/0153.)
      _AC:_ `packages/build` (Bun/Node-only) with an `ExportTarget` interface + registry and a shared Bun
      bundler for user code (engine externalized appropriately); a **web adapter** emitting a static site
      (engine + user bundle + `.rpak`) that runs in a browser; a **`.rpak` writer** (magic+version header →
      GUID-keyed TOC {offset/len/codec/hash} → per-asset-compressed blobs) + a runtime reader that streams
      via **HTTP Range** and lazy-loads per GUID (fits the existing GUID + manifest model); a real small
      project exports and runs from the produced artifact.
      _Links:_ [web-build-target.md](web-build-target.md)

## Stabilization (engine freezers)

- [x] **Fix: mesh missing a required attribute freezes the renderer** — ✅. `MaterialPlugin` checks the
      mesh's vertex layout provides every attribute the material requires (`Material.requiredMeshAttributes()`,
      default `POSITION`/`NORMAL`/`UV_0`) before building a pipeline; a mesh missing one has its draw
      skipped + one dev warning, instead of an invalid pipeline poisoning the frame. Guard decision
      unit-tested (`missingMeshAttributes`). _(bug file kept for user confirmation.)_
      _Links:_ [`../bugs/mesh-without-uv-freezes-renderer.md`](../bugs/mesh-without-uv-freezes-renderer.md)
- [x] **Fix: malformed material uniform breaks the render loop** — ✅. `StandardMaterial` coerces/rejects
      vec fields at construction (short values padded, bad values throw with a clear message), and
      `MaterialPlugin.prepareMaterials` wraps each pack in try/catch (log once + skip) so one bad material
      can't abort the prepare pass / freeze the frame. Unit-tested. _(bug file kept for user confirmation.)_
      _Links:_ [`../bugs/malformed-material-uniform-breaks-render-loop.md`](../bugs/malformed-material-uniform-breaks-render-loop.md)

---

# P1 — Important

## Engine

- [ ] **Input follow-ups** — three additive extensions on the shipped `@retro-engine/input`
      (ADR-0144/0145/0146): (a) **gamepad bindings in the action map** — ✅ **buttons + analog shipped**
      (ADR-0156): digital `gamepadButton()` source (`.button`/`.axis2d`/mixed) plus analog `gamepadAxis()`
      source via new `analogX`/`analogY` roles — `.stick()`/`.stick2d()` shorthands and an `analog` option on
      `.axis`/`.axis2d`, larger-magnitude of the digital legs vs. the stick wins; read from the first
      connected pad's dead-zoned axes; `resolveActionState` takes an `ActionInputs` bundle (now incl.
      `gamepadAxes`); `ActionBinding` reflection enums extended (incl. the `'gamepad'` device fix);
      unit + full-data-path tested; (b) **touch gesture recognizers** — ✅ **tap/swipe/pan/pinch
      shipped** (`recognizeGestures` + `TouchGesturePlugin` emitting `TapGesture`/`SwipeGesture`/`PanGesture`/
      `PinchGesture` messages, tunable `TouchGestureConfig`; 8 unit tests);
      (c) **studio binding editor** (Phase 5, BLOCKED — studio) — edit the `ActionMap` live + an MCP command.
      (d) **text-input character stream** — ✅ **shipped** (ADR-0169): `ReceivedCharacters` per-frame resource
      (layout/Shift-aware via `KeyboardEvent.key`, distinct from the physical `KeyboardInput`), a `char` raw
      event from the DOM backend, pure `charFromKeyDown` filter (single printable chars, drops Ctrl/Meta
      chords, allows AltGr). Unit-tested. Unblocks the UI text-input widget. (IME/CJK composition → follow-up.)
      (e) **key auto-repeat** — ✅ **shipped**: `ButtonInput` surfaces the DOM's repeat `keydown` as a
      per-frame `repeated(code)` set + `justPressedOrRepeated` ("act now, then repeat while held", OS cadence,
      no engine timer). Used by the UI text-input widget (held Backspace/arrows repeat). Unit-tested.
      _Links:_ [input-system.md](input-system.md)
- [ ] **CSS Grid for the UI layout engine** — 🟡 **Phases 1–3b shipped, grid usable** (ADR-0167): (1) pure
      track-sizing + cell-geometry core; (2) `UiStyle` `display`/`gridTemplate*` + `FlexLayoutEngine` grid
      branch placing children into cells; (2b) `.rss` authoring; (3a) **spanning + sparse auto-placement**
      (`placeGridItems` occupancy algorithm, `UiStyle` `gridColumnSpan`/`gridRowSpan`, `.rss`
      `grid-column`/`grid-row: span N`); (3b) **item alignment** — `UiStyle` `justifyItems`/`justifySelf`
      (inline axis) + `alignItems`/`alignSelf` reused for the block axis, a `placeInCell` helper (stretch
      fills, else start/center/end at definite-or-intrinsic size), `.rss` `justify-items`/`justify-self`
      (CSS `start`/`end` normalized); (3c) **auto-rows** — `UiStyle.gridAutoRows` (fixed px) generates
      implicit rows so overflow items flow instead of collapsing; placement refactored around a shared
      `assignGridCells` (bounded → `placeGridItems`, unbounded → new `gridRowCount`), `.rss` `grid-auto-rows`;
      (3d) **explicit line placement** — `UiStyle` `gridColumnStart`/`gridRowStart` (1-based lines), a two-pass
      `assignGridCells` (explicit items reserved first, then auto-flow around them), `.rss` `grid-column`/
      `grid-row` full CSS line syntax (`N / M`, `N / span M`, bare `N` = a line) via `gridLine`; (3e)
      **content distribution** — `justify-content` (column axis) + new `alignContent` (row axis) position the
      track block within the container (`start`/`center`/`flex-end`) when tracks don't fill it, `.rss`
      `align-content`; (3f) **column flow** — `gridAutoFlow: 'row'|'column'` + `gridAutoColumns`, column flow
      fills columns first (transposed onto the tested row-major placer via `gridTrackCount`/`placeGridItems`
      `flow` arg), `.rss` `grid-auto-flow`/`grid-auto-columns`; (3g) **content distribution complete** —
      `justify-content`/`align-content` now also honor `space-between`/`around`/`evenly` (a `contentDistribution`
      helper → leading offset + effective gap). Layout + resolver unit-tested. **Only remaining grid piece:
      `auto`/`minmax` track sizing** (needs the child intrinsic-measure hook + iterative CSS track sizing).
      _Links:_ [css-grid-ui.md](css-grid-ui.md) · [ui-system.md](ui-system.md)
- [ ] **In-game UI depth** — 🟡 **Phases 1 (partial) + 2 shipped**: widgets `UiToggle` (checkbox) +
      `UiSlider` (drag→value) reuse the `Interactable`/`UiClicked` foundation with pure, unit-tested logic;
      **focus + spatial navigation** (ADR-0163) — `UiFocus` resource + `Focusable` marker + message-driven
      `UiNavigate` (tab order via paint order; directional via a pure nearest-neighbour cost), device-
      agnostic + stale-focus clearing; **`:focused`/`:checked` `.rss` pseudo-classes now driven by live
      state** (`UiFocus` / `UiToggle`), so a focus ring is authored in `.rss` (`*:focus`, `Toggle:checked`)
      with no hardcoded border code; **focus activation** (`UiActivate` → `UiClicked` on the focused node,
      so Enter/South drives the click path). Focus is complete (navigate + ring + activate). **Text input**
      ✅ — `UiTextInput` + `UiTextInputPlugin`: click-to-focus, the focused field folds typed chars
      (`ReceivedCharacters`, ADR-0169) + caret keys (Backspace/Delete/arrows/Home/End) into its value,
      mirrored into `UiText` (`placeholder` while empty), emits `UiTextChanged`; pure `insertText`/
      `applyEditKey`/`applyTextInputFrame`, unit-tested. (Caret rendering + held-key repeat + selection →
      follow-ups.) Remaining widgets: scrollview (needs clipping), dropdown/tabs; data binding; virtualized
      list/tree views; screen management.
      _Links:_ [in-game-ui-depth.md](in-game-ui-depth.md) · [ui-system.md](ui-system.md)
- [ ] **Audio mixer buses** — 🟡 **Phases 1–4 shipped** (ADR-0159/0162/0164/0165/0168): (1) named buses +
      per-bus volume; (2) submix trees — `Audio.setBusOutput(bus, output)` routes bus→bus, facade owns the
      graph + rejects cycles; (3) effect inserts — `Audio.setBusEffect(bus, {filter|compressor} | null)`
      inserts a `BiquadFilterNode`/`DynamicsCompressorNode` between a bus's gain and output via one
      `rebuildBus` that composes with submix routing; headless parity; `busEffect` query; (4a) **spatial
      stereo panning** (ADR-0165) — `AudioSource.spatial` + `panWidth`, a per-voice `StereoPannerNode`, an
      `audio-spatial` system panning by world X vs. the `AudioListener` (pure `panForOffset`); (4b) **distance
      attenuation** (ADR-0168) — `AudioSource.refDistance`/`maxDistance`/`rolloff`, the Web Audio linear model
      on a separate per-voice `spatialGain` node (`gain → spatialGain → panner → out`, so it never fights
      volume sync), pure `attenuationForDistance`, the same system driving `setSpatialGain` by 3D distance;
      non-spatial audio unchanged. Unit + stub-context tested. (4c) **falloff models** — `AudioSource.distanceModel`
      selects `'linear'`/`'inverse'`/`'exponential'` (Web Audio `PannerNode` models); `attenuationForDistance`
      gained a `model` param (default `'linear'`, existing calls unchanged), inverse/exponential ignore
      `maxDistance`. Unit-tested. (4d) **3D positional mode** (ADR-0171) — `AudioSource.spatialMode:
      '2d'|'3d'`; a `'3d'` voice uses a Web Audio `PannerNode` (elevation/front-back/HRTF, panning +
      attenuation internal), `PlayOptions.panner`, `setSpatialPosition`/`setListenerPosition`, the
      `audio-spatial` system driving positions; 2D path unchanged. **Listener orientation** ✅ — forward/up
      derived from the `AudioListener`'s transform (pure `listenerAxes`) → `setListenerOrientation`, so 3D
      panning tracks camera rotation. Unit-tested. Remaining: source cones, Doppler, reverb/sidechain.
      _Links:_ [audio-mixer-buses.md](audio-mixer-buses.md) · [audio.md](audio.md)
- [ ] **Windowing** — 🟡 **read side + cursor control shipped**: `Window` resource (logical + physical size +
      dpr, mirrored from the surface) + `WindowResized` event + `syncWindow` + opt-in `WindowPlugin`
      (`'first'`-stage sync, headless-safe). **Write side** (ADR-0170): a `WindowBackend` HAL
      (`DomWindowBackend` + `HeadlessWindowBackend`) + a `CursorOptions` resource (`visible`, `grab:
      'none'|'locked'`) for cursor hiding + Pointer Lock (mouselook), applied on change via pure
      `reconcileCursor` (`cursor-apply` system, `cursorTarget` canvas from the host). **Fullscreen** ✅ — a
      `WindowMode` resource (`fullscreen`) + `WindowBackend.setFullscreen` (Fullscreen API in the DOM backend)
      + pure `reconcileWindowMode`, applied by the same system. Unit + integration tested (mock backend).
      Remaining: present-mode(vsync) control, multi-window. Box unchecked pending user confirmation (§3).
- [ ] **Diagnostics store** — 🟡 **core + asset counts + windowed frame-time stats + in-game overlay shipped**:
      `DiagnosticsStore` (EMA `frameTimeMs` + derived `fps`, `entityCount`, `assetCount`, `frameCount`, plus
      windowed `min`/`max`/`avgFrameTimeMs` + `onePercentLowFps` — the "1% low" stutter metric, via a new
      `FrameTimeWindow` ring + pure `frameTimeStats`) + `updateDiagnostics` + opt-in `DiagnosticsPlugin` (real
      clock delta, `World.entityCount`, `AssetStores.totalAssetCount()`). In-game overlay: `@retro-engine/ui`
      `DiagnosticsOverlayPlugin` + `DiagnosticsText` marker + pure `formatDiagnostics` (now shows `(low N)`)
      rewrite a tagged `UiText` each frame. Unit + integration tested + benched. Remaining: a studio
      diagnostics panel (studio-blocked). Box unchecked pending user confirmation (§3).
- [ ] **ECS ordering depth** — 🟡 **Phases 1, 2, 2b, 4 shipped** (ADR-0157, ADR-0158, ADR-0160): (1) batch
      registration `App.addSystems` + the `system()` spec helper + `.chain()` (identity-based `afterIds`
      edges); (2) named multi-membership `SystemSet` (`{ inSet }`) + `App.configureSet(stage, set, { before,
      after })` — one `byName` topo index unifies labels and sets, so `before`/`after` target set names too;
      (2b) set-level `runIf` gating a whole group (own + set conditions AND-ed; shared `setConditionsPass`
      applied in both the main-stage and render runners); (4) exclusive `world()` systems (ADR-0160) — a
      `Param<World>` for immediate structural edits with same-frame read-back, guarded to be a system's only
      param. (5a) explicit state-transition ordering (ADR-0161) — `onEnter`/`onExit`/`onTransition` accept
      `label`/`before`/`after` via the now-generic `topoSort`, eager cycle detection, additive.
      Registration-time ordering + `SystemInfo.sets` for tooling; unit tested + topo benched. Remaining:
      ambiguity detection (needs per-param access metadata — a prerequisite); state-transition teardown-last
      guarantee (Phase 5b — scene despawn after all user `OnExit`).
      _Links:_ [ecs-ordering-depth.md](ecs-ordering-depth.md) · [system-params.md](system-params.md) · [`../backlog/explicit-state-transition-ordering.md`](../backlog/explicit-state-transition-ordering.md)
- [ ] **System-param sugar** — 🟢 **substantially complete**: all the useful sugar ships — `Local<T>`
      (this session), `MessageReader`/`MessageWriter`, `Trigger` (observers), and `NextState` (state.ts).
      The remaining sketches (items 5-9 in system-params.md: `EventReader/Writer`, stage-scoped params,
      schedule-scoped resources, `QueryState`, exclusive `&mut World`) are explicitly "may not be needed" /
      niche and deferred until a real consumer asks. Box unchecked pending user confirmation (§3).
      _Links:_ [system-params.md](system-params.md)
- [ ] **Texture import settings (`.meta`)** — 🟡 **Phase 1 shipped** (ADR-0166): `TextureImportSettings`
      (filter/wrap/colorSpace) + pure `resolveTextureSampler`/`resolveTextureColorSpace` + `imageFromDecoded`;
      `createImageImporter(decode, settings?)` applies a project-wide default (pixel-art → `{ filter:
      'nearest' }`; data maps → `{ colorSpace: 'linear' }`), unit-tested + backward-compatible. (2)
      per-asset `<name>.meta` overrides — the image importer reads its own sibling `.meta` (JSON of
      `TextureImportSettings`) via `LoadContext.read` and merges over the default; importer-local (no
      asset-server change), missing/malformed sidecar ignored, unit-tested. Remaining: bake `.meta` into the
      packed manifest for the bundle path; mipmaps/trilinear, max-size, PPU (Phase 3).
      _Links:_ [texture-import-settings.md](texture-import-settings.md)
- [ ] **Sprite definitions (`.meta`, Unity-style)** — 🟡 **slicing geometry in place**: grid
      (`TextureAtlasLayout.fromGrid`, pre-existing) + **manual-rect (`fromRects`)** + 9-slice
      (`TextureSlicer`, pre-existing); **`.meta` definition model + resolver** (`SpriteDefinition` +
      `resolveSpriteDefinition` → layout + per-slice pivot/border/ppu/pixelSize, Phase A). Remaining:
      sub-asset minting via composite GUID (ADR-0126, Phase B); the Sprite Editor UI (Phase C, studio).
      _Links:_ [sprite-definitions.md](sprite-definitions.md)
- [ ] **Scenes/prefabs follow-ups** — nested-scene per-instance overrides; hot-reload removal of user
      observers/hooks + selection remap.
      _Links:_ [scenes-and-prefabs.md](scenes-and-prefabs.md) · [`../backlog/nested-scene-instance-overrides.md`](../backlog/nested-scene-instance-overrides.md) · [`../backlog/hot-reload-observer-hook-removal.md`](../backlog/hot-reload-observer-hook-removal.md)

## Renderer

- [ ] **WebGL2 backend + portable shaders** — 🔩 stub. Build out `renderer-webgl2`; WGSL→GLSL via naga;
      capability-gate every WebGPU-only feature (§5.4). **P1-high: hard blocker for Linux/Android/older-Apple
      export** (their Tauri webview has no WebGPU) — must ship before those targets leave experimental.
      _Links:_ [portable-shaders.md](portable-shaders.md)
- [ ] **Clustered forward+** — many-light scaling (SSBO/`storageBuffers`-gated).
      _Links:_ [`../backlog/3d-clustered-forward-plus.md`](../backlog/3d-clustered-forward-plus.md)
- [ ] **Deferred prepass** — complete the `DeferredPrepass` path. _Links:_ [renderer.md](renderer.md)
- [ ] **Culling / LOD** — `VisibilityRange` distance culling + LOD; activate retained instance prep + spatial
      acceleration; instanced mesh-material perf.
      _Links:_ [`../backlog/visibility-range.md`](../backlog/visibility-range.md) · [`../backlog/retained-instance-prep-and-spatial-culling.md`](../backlog/retained-instance-prep-and-spatial-culling.md) · [`../backlog/instanced-mesh-materials.md`](../backlog/instanced-mesh-materials.md) · [`../backlog/event-driven-cull-prepares-followups.md`](../backlog/event-driven-cull-prepares-followups.md)
- [ ] **Shadow/lighting follow-ups** — point/cube shadows, PCSS/temporal PCF, per-light split ranges,
      per-cascade culling/bias, per-camera/per-light PCF overrides. _Links:_ [renderer.md](renderer.md)
- [ ] **Prepass/AO/IBL follow-ups** — alpha-masked prepass coverage; GTAO visibility integral +
      sub-viewport/orthographic AO; configurable IBL radiance clamp.
      _Links:_ [`../backlog/alpha-masked-prepass-coverage.md`](../backlog/alpha-masked-prepass-coverage.md) · [`../backlog/ao-gtao-visibility-integral.md`](../backlog/ao-gtao-visibility-integral.md) · [`../backlog/ao-subviewport-and-orthographic.md`](../backlog/ao-subviewport-and-orthographic.md) · [`../backlog/ibl-radiance-clamp-configurable.md`](../backlog/ibl-radiance-clamp-configurable.md)
- [ ] **HAL: viewport/scissor + gizmo line width** — dynamic `setViewport`/`setScissorRect`; thicker/AA
      gizmo lines via instanced quads.
      _Links:_ [`../backlog/render-pass-viewport-scissor.md`](../backlog/render-pass-viewport-scissor.md) · [`../backlog/gizmo-line-width-instanced-quads.md`](../backlog/gizmo-line-width-instanced-quads.md)

## Editor / Studio

- [ ] **Physics studio integration** — collider gizmos, a physics debug-draw toggle (wireframe of
      colliders/contacts), and inspector polish for the physics components. Physics Phase 4 (ADR-0148).
      _Links:_ [physics.md](physics.md)
- [ ] **Multi-select + multi-object editing** — rubber-band select; multi-target gizmo + inspector
      (the gizmo core already supports N targets).
- [ ] **Scene file actions** — New / Open / Save-As (wire the dead menu items).
      _Links:_ [`../backlog/scene-file-actions.md`](../backlog/scene-file-actions.md)
- [ ] **Clipboard** — cut/copy/paste/duplicate entities and component values.
- [ ] **Asset browser actions** — import-from-OS UI, reimport, duplicate, create-material; asset file-op
      undo; asset-picker multi-select / popover / tags+favorites.
      _Links:_ [`../backlog/asset-file-op-undo.md`](../backlog/asset-file-op-undo.md) · [`../backlog/asset-picker-multi-select.md`](../backlog/asset-picker-multi-select.md) · [`../backlog/asset-picker-popover-layout.md`](../backlog/asset-picker-popover-layout.md) · [`../backlog/asset-picker-tags-and-favorites-persistence.md`](../backlog/asset-picker-tags-and-favorites-persistence.md)
- [ ] **Sprite Editor UI** — slice textures (grid + manual rects), set pivot/border/PPU, writing sprite
      defs into `.meta` and minting sub-asset sprites (currently a `console.info` stub).
- [ ] **Material / shader node editor** — the editor front-end for the Visual shader graph (Renderer P2):
      wire a real material consumer onto the graph-editor toolkit.
- [ ] **Animation clip / dope-sheet / curve editor** — author `AnimationClip` keyframes (only the controller
      graph editor exists today).
- [ ] **Tilemap editor + runtime** — 2D tile authoring + chunk rendering.
- [ ] **Project Settings persist & apply** — the dialog renders but Save is a no-op.
      _Links:_ [`../backlog/editor-human-readable-settings.md`](../backlog/editor-human-readable-settings.md)
- [ ] **Rendered thumbnails + cache** — enable in-engine lit thumbnails (`RENDERED_THUMBNAILS=false`); add
      on-disk thumbnail cache + geometry previews.
      _Links:_ [`../backlog/asset-thumbnail-cache-and-geometry-previews.md`](../backlog/asset-thumbnail-cache-and-geometry-previews.md) · [`../backlog/backgrounded-screenshot-gpu-readback.md`](../backlog/backgrounded-screenshot-gpu-readback.md)
- [ ] **MCP expansion** — `assets.import`, `animController.*`, `studio.run_tests`, per-connection token
      hardening; animation-controller live-debug during play.
      _Links:_ [studio-mcp.md](studio-mcp.md) · [`../backlog/animation-controller-mcp-commands.md`](../backlog/animation-controller-mcp-commands.md) · [`../backlog/animation-controller-live-debug.md`](../backlog/animation-controller-live-debug.md)
- [ ] **Inspector depth** — reference pickers + structural (array/component) edits; per-field reset;
      component reorder; decorator sugar; Add-Component category metadata; hierarchy sibling reordering;
      gizmo↔selection bridge.
      _Links:_ [`../backlog/inspector-reference-pickers.md`](../backlog/inspector-reference-pickers.md) · [`../backlog/inspector-decorator-sugar.md`](../backlog/inspector-decorator-sugar.md) · [`../backlog/add-component-category-metadata.md`](../backlog/add-component-category-metadata.md) · [`../backlog/hierarchy-sibling-reordering.md`](../backlog/hierarchy-sibling-reordering.md) · [`../backlog/gizmo-selection-bridge.md`](../backlog/gizmo-selection-bridge.md)

## Platform / Tooling

- [ ] **Export — Web follow-ups** — the remaining slices of the P0 web target (ADR-0151/0153): studio
      "Build → Web" menu (wrap `runWebExport`); pack a project's `assets/` into the `.rpak` + wire the
      runtime `AssetServer` to a `RangeRpakReader` so exported games load real assets; source maps /
      production polish (phase 6). **jsimgui tree-shaken out ✅** — `createImGuiOverlay` moved from the
      `@retro-engine/renderer-webgpu` index to a `/imgui` subpath, so `bootWebGame`'s `createWebGPURenderer`
      import no longer drags the editor-only imgui/WASM into the game bundle (verified: sample-game export
      `main.js` has 0 `imgui` references; studio/playground use the subpath).
      _Links:_ [web-build-target.md](web-build-target.md)
- [ ] **Export — Desktop (Tauri win/mac/linux)** — per-OS bundles via a **CI matrix** (no cross-compile);
      native `.rpak` streaming via a Tauri custom URI-scheme + mmap (one HTTP-Range loader path shared with
      web). _Links:_ [web-build-target.md](web-build-target.md)
- [ ] **Integrated frame benches** — per-system cost attribution in the bench suite (CLAUDE.md §11).
      _Links:_ [`../backlog/integrated-frame-benches.md`](../backlog/integrated-frame-benches.md)

## Stabilization (P1 bugs)

- [ ] **MCP `entity.despawn` dropped by a later `scene.save`.** _Links:_ [`../bugs/mcp-entity-despawn-not-reflected-in-scene-save.md`](../bugs/mcp-entity-despawn-not-reflected-in-scene-save.md)
- [ ] **MCP `component.set` corrupts entity-ref + vec3 fields.** _Links:_ [`../bugs/studio-mcp-component-set-entity-and-vec3.md`](../bugs/studio-mcp-component-set-entity-and-vec3.md)
- [ ] **`MaterialPlugin.queueMaterials3d` lacks a camera sub-graph filter.** _Links:_ [`../bugs/material-plugin-camera-subgraph-filter.md`](../bugs/material-plugin-camera-subgraph-filter.md)
- [ ] **Inspector transform fields round small values to 0** (FBX→glTF cm→m scales). _Links:_ [`../bugs/inspector-transform-fields-round-small-values-to-zero.md`](../bugs/inspector-transform-fields-round-small-values-to-zero.md)
- [ ] **OBJ base mesh swaps NORMAL/UV attribute order.** _Links:_ [`../bugs/obj-base-mesh-normal-uv-attribute-order.md`](../bugs/obj-base-mesh-normal-uv-attribute-order.md)

---

# P2 — Nice-to-have

## Engine

- [ ] **Generic relationships** — Bevy 0.16-style arbitrary bidirectional relations (today only `Parent`/`Children`).
- [ ] **Generic sub-apps API** — arbitrary sub-apps with their own schedules (today only the render world).
- [ ] **Parallel executor / task pools** — multithreaded schedule + async compute; async asset-processing pipeline.
- [ ] **Computed/sub-states + `StateScoped` entities** — beyond per-pair transitions + state-scoped resources.
- [ ] **Math depth** — curves/splines, easing, noise/random, color-space conversions, OBB/bounding-sphere.
      _Links:_ [transform-and-hierarchy.md](transform-and-hierarchy.md)

## Renderer

- [ ] **GPU-driven & compute** — HAL compute path (`createComputePipeline`/dispatch) + indirect/multi-draw,
      gated on `computeShaders`/`indirectDraw` (§5.4, **WebGPU-only**); unlocks GPU culling, occlusion
      culling, meshlets, light clustering, GPU particles, compute GTAO.
      _Links:_ [`../backlog/ao-compute-gtao.md`](../backlog/ao-compute-gtao.md)
- [ ] **Post-FX (fidelity)** — bloom, depth of field, SSR/SSGI, auto-exposure, color grading/LUT
      (tony_mc_mapface), FXAA/SMAA, chromatic aberration, OIT.
      _Links:_ [renderer.md](renderer.md) · [`../backlog/tonemapping-tony-mcmapface.md`](../backlog/tonemapping-tony-mcmapface.md)
- [ ] **Sky / atmosphere / volumetrics** — procedural atmospheric sky (day/night), volumetric fog &
      lighting, god rays.
- [ ] **Particles** — CPU particles (portable, WebGL2-safe) + GPU particles (compute-driven, WebGPU-only,
      `computeShaders`-gated); emitters/modules.
- [ ] **Light probes / irradiance volumes / lightmaps** — needs baking infrastructure.
- [ ] **Visual shader graph** — node-graph material authoring on the graph-editor toolkit (ADR-0137/0143) →
      WGSL codegen (+ GLSL via naga for WebGL2), behind `ExtendedMaterial`. Pairs with the editor
      Material/shader node editor. *User-flagged "eventually a must."*
- [ ] **Decals, terrain, water** — new subsystems.
- [ ] **Texture compression + mipmap gen** — BCn/ASTC/ETC; mip generation helper.
- [ ] **Raytraced GI (Solari-style)** — far future; RT/compute-gated.

## Editor / Studio

- [ ] **Timeline / cutscene sequencer** — track-based (animation / audio / activation / signal tracks);
      editor authoring + runtime playback.
- [ ] **Editor flexbox/grid layout helper** — ~200-line immediate-mode flex solver over ImGui (Clay-style
      `FIXED/GROW/FIT/PERCENT`) so panels/toolbars express "row, these left, justify rest to end, fill
      remaining" without hand-computed pixels; **shares the in-game UI pure-TS flex core**. (Editor-focused.)
- [ ] **Atlas / particle / VFX editors** — authoring UIs.
- [ ] **RetroHuman dedicated editor** — isolated preview, textured + sliders, Save → bake mesh + GLB export.
      _Links:_ [retrohuman-editor.md](retrohuman-editor.md)
- [ ] **Terrain / navmesh / audio-mixer / UI-canvas editors** — authoring surfaces for those subsystems.
- [ ] **VCS integration + global project search.**

## Platform / Tooling

- [ ] **Export — Mobile (Tauri iOS/Android)** — App Store / Play packaging; **depends on WebGL2** (no
      WebGPU in the mobile webview). _Links:_ [web-build-target.md](web-build-target.md)
- [ ] **Release automation** — provenance, changelog, snapshot releases, code signing, auto-update.
      **Do not start before 0.1.0.** _Links:_ [release-automation.md](release-automation.md)

## Gameplay / AI

- [ ] **Navmesh + AI agents** — navmesh generation, nav-agent component, pathfinding. *(User: less
      important than core physics.)*
- [ ] **Concave / mesh colliders** — beyond the P0 primitive colliders. *(User: less important than the
      entirety of 2D/3D physics.)*

---

## Explicitly out of scope for now

Not requested and not planned; recorded so their absence is a decision, not an oversight. Promote to a
tier if/when they're wanted.

- **Networking / replication** (Bevy leaves this to the ecosystem too).
- **Localization / i18n.**
- **In-studio code editor** — locked out by decision; users bring an external IDE (ADR-0090 family).

---

## Coverage note

Built from a full audit of the codebase (renderer / engine / studio inventories), the existing 145
ADRs + 46 backlog + 27 roadmap + 7 bug files, and a Bevy-parity catalog. Every 🔩/❌/🟡 in
[`../reference/`](../reference/README.md) has a home above. When adding items, link existing
`../backlog/` and `../roadmap/` files rather than duplicating them.
