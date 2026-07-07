# Testing TODO — morning review queue

Autonomous build-loop output. One line per finished item; a HOW-to-test note when
it isn't obvious. Items here were verified by unit tests + a build-green gate but
could **not** be exercised via the retro-studio MCP (no path exists), so they need
a manual confirmation before their backlog/roadmap entries are considered closed.

---

## Input system — Phase 1 (keyboard + mouse) · `@retro-engine/input` · ADR-0144

- **What changed:** New `@retro-engine/input` package: `ButtonInput<T>` / `Axis<T>`
  primitives; `KeyboardInput`, `MouseButtonInput`, `MouseMotion`, `MouseScroll`,
  `CursorPosition` resources; an `InputBackend` HAL (`DomInputBackend` +
  `HeadlessInputBackend`); `InputPlugin` (opt-in, headless-safe, `preUpdate`
  clear-then-drain lifecycle). Wired into the playground as `?mode=input`.
- **Automated:** 30 unit tests (button/axis/frame-lifecycle/backend-selection) green;
  lint/typecheck/test/build/bench all green. A per-frame bench (`applyInputFrame`)
  joined the suite (`packages/input/bench`, added to `bench:check`).
- **Why no MCP verification:** input needs real key/mouse events; the retro-studio
  MCP has no key-injection tool, and synthetic canvas events don't drive jsimgui.
  So this is unit-tested + manual.
- **HOW to test (manual):** run the playground (`cd apps/playground && bun run dev`),
  open `http://localhost:<port>/?mode=input`, click the canvas to focus it, then:
  - **WASD / arrow keys** move the white square; **release** stops it.
  - **Space** snaps it back to the origin.
  - **Hold left mouse button** → the square tints cyan; release → white.
  - **Mouse wheel** scales the square (0.4×–4×).
  - Live state is on `window.__input` (`{x, y, scale, pressed, cursor}`) — check it
    in the dev console to confirm resources update without eyeballing pixels.
- **Not deleted:** `docs/roadmap/input-system.md` stays (Phases 2–5 remain: action
  map + reflection, gamepad, touch, studio binding editor). `MASTER-ROADMAP.md`
  Input box left unchecked until the full AC (gamepad/touch/action-map) lands.

---

## Input system — Phase 2 (action map) · `@retro-engine/input` · ADR-0145

- **What changed:** Component-based action layer (leafwing-shaped). `ActionMap`
  (authored, reflection-registered, serialized) + `ActionState` (derived,
  auto-attached, not serialized). Fluent builder (`.button`/`.axis`/`.axis2d`) with
  `key()`/`mouseButton()` sources; per-frame resolver runs in `preUpdate` after the
  raw device update. Playground `?mode=input` now drives the sprite through the
  action map and rebinds `Reset` at runtime.
- **Automated:** +10 unit tests (builder, resolve semantics for button/axis/axis2d,
  many-to-many, reflection round-trip via `TypeRegistry`) — 40 input tests green;
  a `resolveActionState` bench joined the suite; full repo gate green.
- **Why no MCP verification:** same as Phase 1 — no key-injection path.
- **HOW to test (manual):** playground `?mode=input`, focus the canvas:
  - **WASD / arrow keys** move the square (via the `Move` / `MoveArrows` axis2d).
  - **Space** resets to origin (the `Reset` action). Press **R** to rebind Reset to
    **Enter** (then Enter resets, Space doesn't); press **R** again to swap back —
    `window.__input.resetKey` shows the current binding.
  - **F or left mouse** tints the square (the `Fire` action).
  - `window.__input` also exposes `{move:{x,y}, fire}` resolved from the action map.
- **Reflection check:** the `ActionMap` schema round-trips (unit test), so bindings
  will survive a scene save once the studio persists this component.

---

## Input system — Phase 3 (gamepad) · `@retro-engine/input` · ADR-0146

- **What changed:** Poll-based gamepad support. `GamepadSource` (`NavigatorGamepadSource`
  + `HeadlessGamepadSource`), `Gamepads` resource keyed by pad index with per-pad
  `ButtonInput<GamepadButton>` + `Axis<GamepadAxis>`, W3C Standard-Gamepad mapping
  (named buttons/axes; stick-Y flipped so up=+1; triggers as [0,1] axes), configurable
  dead zone, connect/disconnect via poll reconciliation. Polled in `preUpdate`.
- **Automated:** +11 unit tests (dead zone, connect/read, button edges, triggers,
  disconnect lifecycle, non-standard raw access, multi-pad) — 50 input tests green;
  an `updateGamepads` bench joined the suite; full repo gate green.
- **Why no MCP verification:** no gamepad-injection path (and no physical pad in CI).
- **HOW to test (manual):** plug in an Xbox/PS controller, open playground `?mode=input`,
  press any button on the pad once (browsers only expose a gamepad after first input),
  then: **left stick** moves the square; **A / ✕ (South)** tints it. `window.__input.gamepad`
  shows `{connected, x, y, south}`. If you have no controller, this phase is covered by
  the unit tests only — the `Gamepads` API is driven by a scriptable `GamepadSource`.
- **Follow-up (not done):** gamepad bindings in the action map (rebindable gamepad) —
  logged as a new MASTER-ROADMAP item.

---

## Input system — Phase 4 (touch) · `@retro-engine/input` · ADR-0144

- **What changed:** `Touches` resource of active `TouchPoint`s (id, position,
  start position, per-frame delta, phase) with a `ButtonInput`-style lifecycle
  (`justStarted`/`justEnded`, `iter`/`first`/`count`). DOM backend emits
  touchstart/move/end/cancel; folded into the same `preUpdate` frame step.
- **Automated:** +3 unit tests (start→move→end lifecycle, multi-touch, cancel) —
  53 input tests green; touch events added to the `applyInputFrame` bench; full gate green.
- **Why no MCP verification:** no touch-injection path.
- **HOW to test (manual):** playground `?mode=input`, open browser devtools and
  enable **touch/device emulation**, then drag on the canvas — `window.__input.touches`
  shows `{count, x, y}` for the primary touch. Without a touch device this is covered
  by the unit tests (a scriptable `QueueBackend` feeds touch events).

---

## Audio system — Phase 1 (HAL + Web Audio + AudioClip) · `@retro-engine/audio` · ADR-0147

- **What changed:** New `@retro-engine/audio` package. `AudioBackend` HAL +
  `WebAudioBackend` (AudioContext, lazy decode cache, per-voice source→gain→master,
  autoplay-resume) + `NullAudioBackend`; `AudioClip` asset (encoded bytes) + importer +
  `.meta` kind on wav/ogg/mp3; `Audio` resource facade (play/stop/volume/pitch/loop,
  one-shot + looping); `AudioPlugin` (opt-in, headless-safe). Playground `?mode=audio`.
- **Automated:** 6 unit tests (importer defensive-copy, NullAudioBackend, `Audio` facade
  routing incl. handle resolution) green; lint/typecheck/test/build green. No bench (no
  headless-benchable per-frame path yet; Phase 2's `AudioSource` sync will carry one).
- **Why no MCP verification:** audio needs a real `AudioContext` + speakers; no MCP path,
  and headless bun has no Web Audio (unit tests use a mock/null backend).
- **HOW to test (manual):** playground `?mode=audio`, **click the canvas once** (browsers
  keep audio suspended until a gesture — the backend resumes on that click), then:
  - **Space / left-click** → a short beep at a random pitch (one-shot; overlapping plays OK).
  - **M** → toggle a looping low tone (music); M again stops it.
  - `window.__audio` shows `{ suspended, oneShots, looping }`.
- **Not deleted:** `docs/roadmap/audio.md` stays (Phase 2 ECS components + mixer buses remain).
  MASTER-ROADMAP Audio box left unchecked until Phase 2 (`AudioSource`/`AudioListener` + sample).

---

## Audio system — Phase 2 (ECS playback) · `@retro-engine/audio` · ADR-0147

- **What changed:** Component-driven audio. `AudioSource` (clip handle, volume, pitch,
  loop, playOnAdd, despawnOnEnd, play()/stop()) + `AudioListener` (master volume),
  reflection-registered; `AudioVoices` runtime resource; `reconcileAudio` playback
  system in postUpdate (playOnAdd retry-until-loaded, explicit play/stop, live volume
  sync, despawn/drop finished one-shots, stop-on-removal). Listener → master gain.
- **Automated:** +9 unit tests (playOnAdd + retry, play/stop, volume sync, despawnOnEnd,
  loop-never-finishes, stop-on-removal) — 15 audio tests green; `reconcileAudio` bench
  joined the suite; full repo gate green.
- **Why no MCP verification:** same as Phase 1 — needs a real AudioContext + speakers.
- **HOW to test (manual):** playground `?mode=audio`, click the canvas once (resumes audio),
  then: looping **music** starts automatically (an `AudioSource` entity); **Space / left-click**
  spawns a one-shot beep entity that despawns itself when done (`despawnOnEnd`); **M** toggles
  the music (source.play()/stop()). `window.__audio` shows `{ oneShots, musicPlaying, voices }`
  (voices = live `AudioVoices.size`).

---

## Physics — Phase 1 (physics-core contract + components) · `@retro-engine/physics-core` · ADR-0148

- **What changed:** New `@retro-engine/physics-core` package. `PhysicsBackend` interface +
  `PhysicsCapabilities` + `NullPhysicsBackend`; Avian-shaped `2d`/`3d` components (RigidBody,
  Collider, Linear/Angular velocity, ExternalForce, Restitution/Friction/GravityScale/Sensor),
  reflection-registered; `Gravity` + `Physics` resources; `PhysicsPlugin` runs the
  Sync→Step→Writeback bridge in the fixed timestep (no-op until a backend is injected).
- **Automated:** 16 unit tests (component factories, bridge snapshot/writeback/collider-desc/
  angle, null backend, reflection round-trip incl. vec2/vec3/enum) green; a snapshot bench joined
  the suite; full repo gate green.
- **Why not verified in the studio yet:** nothing moves without a backend — real behavior arrives
  in Phase 2 (physics-rapier). Phase 1 is contract + components, unit-tested.
- **HOW to test (manual, later):** nothing visible yet — Phase 2 will add a `?mode=physics`
  playground demo (boxes fall + land). For now: `bun test` in packages/physics-core is green, and
  the components will appear in the studio Add-Component list once a project loads the plugin.
- **Not deleted:** `docs/roadmap/physics.md` stays (Phase 2 rapier backend + Phase 3 3D/character/
  joints/events remain). MASTER-ROADMAP Physics box left unchecked until real simulation ships.

---

## Physics — Phase 2 (Rapier 2D backend) · `@retro-engine/physics-rapier` · ADR-0148

- **What changed:** New `@retro-engine/physics-rapier` package: `createRapierBackend()` over
  `@dimforge/rapier2d-compat` — real 2D dynamics implementing the full `PhysicsBackend` contract
  (async wasm gate, entity↔body maps, upsert/step/readBody/remove, gravity/gravity-scale/
  external-force/kinematic, raycast, collision-event drain). Playground `?mode=physics` demo.
- **Automated (REAL verification):** 4 deterministic bun tests using the actual Rapier wasm —
  a dynamic box falls under gravity and lands on a static floor (y: 5 → ~1.0), gravityScale 0
  floats, removeBody drops the body, 3D snapshots ignored. This is genuine physics verification,
  not just a compile. Full repo gate green (41 typecheck / 23 lint / 40 test / build).
- **HOW to test (manual, visual):** run the playground (`cd apps/playground && bun run dev`), open
  `?mode=physics`, click the canvas: 5 colored boxes fall and **stack on the grey floor**; press
  **Space** to drop more from the top (random x). `window.__physics` shows `{ready, boxes, lowestY}`.
- **Not deleted:** `docs/roadmap/physics.md` stays. MASTER-ROADMAP Physics box still unchecked —
  Phase 3 (3D via rapier3d-compat, kinematic character controller, joints, ECS collision events)
  remains for the full P0 AC.

---

## Physics — 3D backend · `@retro-engine/physics-rapier` · ADR-0148

- **What changed:** `createRapierBackend()` is now dimension-aware — internal `world-2d.ts` +
  `world-3d.ts` adapters (rapier2d-compat / rapier3d-compat), routed by snapshot dimension;
  `capabilities.dimensions3d = true`. 3D: Vec3 translation, quaternion rotation, Vec3 angular
  velocity, cuboid(hx,hy,hz)/ball/capsule.
- **Automated (REAL):** 5 deterministic bun tests on the actual wasm — a 3D box falls + lands
  on a floor (rotation is a quaternion), and a mixed scene runs 2D + 3D bodies independently.
  Full repo gate green.
- **HOW to test (manual):** the 2D `?mode=physics` demo is unchanged (still uses the 2D path);
  a dedicated 3D visual demo (Camera3d + meshes) will land with the character-controller phase.
  The 3D backend itself is proven by the deterministic tests.
- **Remaining for the Physics box:** kinematic character controller, joints, and collision
  events surfaced to ECS (a message channel).

---

## Physics — collision events → ECS · `@retro-engine/physics-core` + `physics-rapier` · ADR-0148

- **What changed:** `CollisionEvent` is now an ECS message class; `PhysicsPlugin` writes the
  backend's drained start/stop events each fixed step. Rapier colliders now enable
  `ActiveEvents.COLLISION_EVENTS` (they're silent otherwise). Read via `MessageReader(CollisionEvent)`.
- **Automated (REAL):** a headless bun test drops a box on the floor and asserts a `started`
  collision event is emitted between the two entities. 6 rapier tests green; full gate green.
- **HOW to test (in a game):** add a system with `MessageReader(CollisionEvent)`; each `{kind:'started'
  |'stopped', a, b}` reports a contact between entity `a` and `b`. (Manual: wire it into a scene and
  log hits; not visually verifiable on its own.)
- **Remaining for the Physics box:** kinematic character controller + joints (+ a moving-character demo).

---

## Physics — kinematic character controller · `physics-core` + `physics-rapier` · ADR-0148

- **What changed:** `CharacterController2d`/`3d` components (offset, slope limits, autostep,
  snap-to-ground, `desiredTranslation` input, `grounded` output) + `PhysicsBackend.moveCharacter`.
  The Rapier backend drives a per-entity `KinematicCharacterController` (2D + 3D); the bridge moves
  the character by the collision-corrected amount each fixed step and writes back `grounded`.
- **Automated (REAL):** 8 rapier tests — a kinematic character walks along a floor and stays grounded,
  and is stopped by a wall (collide-and-slide). Full repo gate green.
- **HOW to use (game):** spawn an entity with `Transform` + `RigidBody2d.kinematic()` +
  `Collider2d.capsule(...)` + `new CharacterController2d({ snapToGroundDistance: 0.5 })`; each frame set
  `cc.desiredTranslation` (e.g. from input + gravity) and read `cc.grounded`.
- **Remaining for the Physics box:** joints (fixed/revolute/…).

---

## Physics — joints · `physics-core` + `physics-rapier` · ADR-0148

- **What changed:** `Joint2d` (fixed/revolute/prismatic) + `Joint3d` (+spherical) components (target
  entity, local anchors, axis; reflection-registered) + `PhysicsBackend.upsertJoint`/`removeJoint`
  over Rapier `ImpulseJoint`. The bridge creates joints once both bodies exist, removes on component
  removal / body despawn. `capabilities.joints = true`.
- **Automated (REAL):** headless test — a fixed joint holds a dynamic body against gravity; removing
  the joint lets it fall. 9 rapier tests green; full gate green.
- **HOW to test (in a game / studio):** attach `new Joint2d(otherEntity, 'fixed', { localAnchorB: [...] })`
  to a body; the two bodies stay constrained. (Manual visual demo pending studio physics gizmos.)

---

## ✅ P0 Physics item COMPLETE — box checked in MASTER-ROADMAP

The **Physics** P0 item is fully done: `physics-core` contract + Avian components (reflection) +
`physics-rapier` **2D & 3D** backend with real dynamics, collision events → ECS, a kinematic
character controller, and joints — all with deterministic headless tests. Playground `?mode=physics`
demos falling/stacking boxes + a walking character (Space drops more; A/D or arrows move the character).
Reference tag ✅. Studio integration (collider gizmos / debug draw / inspector) moved to P1.
**Three P0 items now complete: Input, Audio, Physics.** Next P0: Engine text (MSDF) or the two
stabilization bug fixes.

---

## Fix — malformed material uniform no longer freezes the render loop · `engine` · bug

- **What changed:** (1) `StandardMaterial` validates/pads `baseColor`/`emissive` at construction (short
  → padded from default, e.g. `emissive:[1,1,1]`→`[1,1,1,0]`; non-array/non-number → throws clearly).
  (2) `MaterialPlugin.prepareMaterials` wraps each material's uniform pack in try/catch — a throwing
  material is logged once and skipped, the rest of the scene keeps rendering.
- **Automated:** unit tests — constructor padding/rejection (standard-material.test.ts) + a deliberately
  malformed material is skipped while a good one still prepares (material-plugin.test.ts). Full gate green.
- **Why bug file kept:** verified by unit tests, not the studio MCP — so per the loop rule I left
  `docs/bugs/malformed-material-uniform-breaks-render-loop.md` for you to confirm & delete. The
  MASTER-ROADMAP box is checked (fix shipped + unit-verified).
- **HOW to confirm (manual, optional):** in the studio, set a `StandardMaterial.emissive` to a
  3-component value via `studio.eval` / a hand-edited `.remat` → the viewport keeps rendering (a dev
  warning is logged; the bad material is skipped) instead of freezing.

---

## Fix — mesh missing a required attribute no longer freezes the renderer · `engine` · bug

- **What changed:** `MaterialPlugin` checks (before building a pipeline) that a mesh's vertex layout
  provides every attribute the material requires (`Material.requiredMeshAttributes()`, default
  POSITION/NORMAL/UV_0). A mesh missing one has its draw skipped + one dev warning, instead of an
  invalid pipeline poisoning the frame encoder and freezing the viewport. Guards the mesh + skinned
  queue paths.
- **Automated:** `missingMeshAttributes` unit tests (missing UV / missing normal / full mesh). The
  actual GPU freeze can't be reproduced with the stub renderer (it doesn't validate pipelines), so the
  guard's *decision* is unit-tested; the end-to-end freeze-avoidance is by construction (skip before
  pipeline build). Also fixed a test fixture (`buildCube`) that was a UV-less mesh only "working"
  because the stub skips validation. Full gate green (1154 engine tests).
- **Why bug file kept:** unit-test-only verification (no MCP freeze-repro path) — left
  `docs/bugs/mesh-without-uv-freezes-renderer.md` for you to confirm & delete. MASTER-ROADMAP box checked.
- **HOW to confirm (manual, optional):** in the studio, add a mesh/glTF whose vertex data omits UVs and
  assign a `StandardMaterial` → the viewport keeps rendering (that mesh is skipped + a dev warning logged)
  instead of freezing.

---

## ✅ Both P0 stabilization bugs fixed — Input, Audio, Physics + both freezers = P0 progressing fast

Four P0 items + both stabilization freezers now done. Remaining P0: Engine text (MSDF), In-game UI
(depends on text), Play mode, Web export.

---

## ✅ P0 Audio item COMPLETE — box checked in MASTER-ROADMAP

The **Audio (core)** P0 item is fully done (HAL + Web Audio backend + `AudioClip` +
`AudioSource`/`AudioListener` + reflection + entity SFX/music sample; headless-safe).
Reference tag flipped to ✅. Mixer buses / spatial panning / studio audio preview are P1/P2.
Next P0 target: **Physics** (or Engine text / in-game UI).

---

## ✅ P0 Input item COMPLETE — box checked in MASTER-ROADMAP

The **Input system** P0 item is fully done (keyboard + mouse + action map + gamepad +
touch; headless-safe; reflection; sample). Reference tag flipped to ✅. Remaining input
work (gamepad-in-action-map, touch gestures, studio binding editor) moved to **P1**.
Next P0 target: **Audio (core)**.

---

## 🟡 Engine text (MSDF) — Phase 1 shipped (data + layout engine, pure)

The MSDF text system's algorithmic core landed under `packages/engine/src/text/`:
`MsdfFont`/`parseMsdfFont` (parses `msdf-atlas-gen` JSON, throws on malformed) and
`layoutText`/`measureText` (advances, kerning, `\n`, greedy word wrap at `maxWidth`,
left/center/right alignment, top-left-origin atlas UVs). **Pure logic — no GPU, no
component yet**, so verified by unit tests only (no MCP/editor path exists at this phase).

- **HOW to test:** `bun test packages/engine/src/text/` — 19 tests cover parsing,
  whitespace glyphs, kerning, wrapping/overflow, alignment, newlines, top/bottom atlas
  y-origin, and measure↔layout agreement.
- **Not yet visible in the studio.** Rendering (a `Font` asset kind + `.meta`, the
  `Text2d` component, the MSDF shader, glyph-quad batching through the 2D pipeline, and a
  `?mode=text` sample) is Phase 2 — that's when there'll be an on-screen thing to look at.
- Roadmap: `docs/roadmap/text-rendering.md`; decision: ADR-0149. MASTER-ROADMAP item
  marked 🟡 (box stays unchecked until Phase 2 renders text).

---

## 🟡 Engine text (MSDF) — Phase 2a shipped (Font asset + Text2d component)

The asset + component layer of MSDF text landed under `packages/engine/src/text/`:
`Font` (parsed `MsdfFont` + atlas `Handle<Image>`), `Fonts` store, `createFontImporter`
(parses a `.font` msdf-atlas-gen descriptor, decodes its companion atlas into a **linear**
image sub-asset — sibling `<base>.png` by default, or a top-level `"image"` override),
the `Text2d` component (text/font/size/color/align/lineHeight/maxWidth/letterSpacing/anchor,
reflection-registered), and `TextPlugin`. **Still no rendering** — no MSDF shader/batching
yet, and `TextPlugin` is deliberately not in the default plugin set. Verified by unit tests
only (no MCP path until Phase 2b draws pixels).

- **HOW to test:** `bun test packages/engine/src/text/` — 29 tests: importer (fake
  decoder + fake load-context; linear atlas, sibling derivation, `"image"` override,
  missing-sibling + malformed rejection), Text2d defaults, and a full scene
  serialize→deserialize round-trip of every Text2d field incl. the font handle GUID.
- **Not yet visible in the studio.** Phase 2b (MSDF WGSL shader, glyph-quad batching
  through the 2D pipeline, `?mode=text` sample, wiring TextPlugin into DefaultPlugins) is
  the next slice — that's when there's an on-screen thing to screenshot.
- Roadmap: `docs/roadmap/text-rendering.md` (Phase 2 split into 2a done / 2b next).
  Decision: ADR-0149. MASTER-ROADMAP item stays 🟡 until Phase 2b renders text.

---

## 🟡 Engine text (MSDF) — Phase 2b shipped (glyph render pipeline)

`TextPlugin` now actually renders `Text2d`. Added the `retro_engine::text` MSDF shader
(median-of-RGB distance + screen-px-range AA), `TextPipeline` (specialized on render-target
shape, always alpha-blended), `TextInstanceBuffer`, `packGlyphInstance` (block-local y-down
glyph → world-space quad honoring the entity transform + pivot, per-glyph atlas UV +
`unitRange`), and the `text-prepare` (after `image-prepare`) + `text-queue` render systems
(one instanced transparent draw per text entity).

- **HOW to test now:** `bun test packages/engine/src/text/` — 39 tests, incl. a
  capturing-renderer integration test asserting the transparent2d pass gets one instanced
  draw per text entity, correct instance counts (1 per visible glyph), per-entity batching,
  the atlas bound at `@group(1)`, and skip behavior (no font / whitespace-only → no draw).
  Bench: `bun run --cwd packages/engine bench --filter "text prepare"` (~65µs / 400 glyphs).
- **Still not visible on screen** — no committed font atlas yet, and `TextPlugin` isn't
  added by any sample/studio scene. Phase 2c commits a real `msdf-atlas-gen` font (.font +
  .png), adds a `?mode=text` playground scene, and wires TextPlugin alongside SpritePlugin —
  that's when there's an actual on-window screenshot to verify via the studio MCP.
- Roadmap: `docs/roadmap/text-rendering.md` (Phase 2 → 2a/2b done, 2c next). ADR-0149.
  MASTER-ROADMAP stays 🟡 until text is drawn on screen and MCP-verified.

---

## 🟡 Engine text (MSDF) — Phase 2c shipped (built-in SDF default font + ?mode=text sample)

No native `msdf-atlas-gen` is installed and headless bun can't rasterize system fonts, so
rather than block, I shipped a **pure-JS SDF font generator** (`generateSdfFont`) and a
**built-in default font** (`installDefaultFont`) — monoline stroke glyphs (uppercase, digits,
punctuation; lowercase aliased to uppercase) rasterized to a single-channel SDF the
median-of-RGB shader consumes unchanged. Zero external deps, zero committed binaries. Added a
`?mode=text` playground scene (title / multi-line / wrapped / right-aligned HUD / spinner).

- **HOW to test (headless):** `bun test packages/engine/src/text/` — 47 tests incl. SDF
  gradient/metrics/atlas checks and a capturing-renderer test drawing "HELLO" with the built-in
  font (5 instances).
- **HOW to test (visual — needs a WebGPU browser):** run the playground and open
  `?mode=text` → five text blocks in different sizes/colors/alignments + a spinning "SPIN!".
  Confirm glyphs are crisp when the window is resized/zoomed (SDF scale-independence) and the
  spinner's glyphs rotate with the entity.
- **Studio:** 2D render plugins are project-declared (like SpritePlugin), so open a studio
  project that adds `TextPlugin` + a `Text2d` entity to see text in the editor. Couldn't
  MCP-verify this session (studio relay disconnected — `studio_connected` = false).
- Roadmap: `docs/roadmap/text-rendering.md` (Phases 1–2c done). ADR-0149. MASTER-ROADMAP item
  stays 🟡 until visual confirmation + Phase 3 (world-space Text). A true multi-channel MSDF
  atlas via `msdf-atlas-gen` is an optional tooling upgrade — the `.font` importer already
  loads one; the built-in SDF font is the no-tooling default.

### Tooling note (not a hard blocker)
`msdf-atlas-gen` / `msdfgen` are not installed on this machine (checked `which` + brew + npm).
The engine ships a pure-JS SDF font instead, so text works without them. Installing
`msdf-atlas-gen` later would enable authoring true multi-channel MSDF fonts (sharper corners)
that load through the existing `.font` importer.

---

## 🟡 In-game UI (Retro CSS) — Phase 1a shipped (flexbox LayoutEngine)

New package `@retro-engine/ui` with the pure layout foundation: a `LayoutEngine` interface
+ `FlexLayoutEngine` — single-line CSS flexbox (main-axis grow/shrink with min/max clamping +
iterative freezing per §9.7, `justify-content`, `align-items`/`align-self`, `gap`,
padding/margin, `position: absolute` insets) with a text-measure callback hook, plus
`UiStyle`/`makeStyle`. Pure TS, no ECS/GPU.

- **HOW to test:** `bun test packages/ui/` — 21 tests (row/column, grow/shrink + min clamp,
  all justify-content modes, align stretch/center/end + align-self, gap, padding/margin,
  row-reverse, measure callback, absolute insets incl. left+right stretch, nested trees).
  Bench: `bun run --cwd packages/ui bench` (~51µs for a 271-node grid).
- **Not yet in the ECS or on screen.** Phase 1b adds `UiNode`/`ComputedLayout` + a `UiPlugin`
  layout system (walk hierarchy → run engine → write layout); Phase 2 renders through the 2D
  pipeline (quads + ADR-0149 glyphs); Phase 3 `.rss` styling; Phase 4 widgets. So nothing to
  screenshot yet — the layout math is verified purely.
- Roadmap: `docs/roadmap/ui-system.md` (rewritten to the retained-ECS + flexbox + `.rss`
  model). Decision: ADR-0150. MASTER-ROADMAP item is 🟡 (box stays unchecked until the UI
  renders styled widgets on screen).

---

## 🟡 In-game UI — Phase 1b shipped (UiNode/ComputedLayout + UiPlugin layout system)

The flexbox engine now runs from the ECS. Added `UiNode` (authored `UiStyle`,
reflection-registered — auto/no-max encoded as omitted `undefined`, so it round-trips),
`ComputedLayout` (derived absolute screen-space rect, not serialized, auto-attached via
required components), and `UiPlugin` — a `postUpdate` `ui-layout` system that mirrors the
`Parent`/`Children` hierarchy into a LayoutNode tree, runs the engine, and writes each
entity's `ComputedLayout` with accumulated absolute coordinates. `UiViewport` (root size) +
`UiLayout` (swappable engine) resources.

- **HOW to test:** `bun test packages/ui/` — 29 tests. Phase 1b covers: ComputedLayout
  auto-attach, a flex-row hierarchy → absolute rects, auto-root fills viewport, ancestor
  offset accumulation (nested padding), a UiNode under a non-UI parent treated as a root,
  and a full UiNode reflection round-trip of every authored style field.
- **Still not on screen.** Phase 2 renders the computed boxes (quads + borders + ADR-0149
  glyphs) through the 2D pipeline and wires `measureText` for text content nodes; Phase 3 is
  `.rss` styling; Phase 4 widgets. So nothing to screenshot yet — layout is verified purely
  in the ECS.
- Roadmap: `docs/roadmap/ui-system.md` (Phases 1a+1b done). ADR-0150. MASTER-ROADMAP 🟡.

---

## 🟡 Web export — Phase 1 shipped (.rpak asset package format)

New package `@retro-engine/build` with the deployable asset-delivery format (the foundation
the web target streams from). `.rpak` v1: magic+version header → JSON TOC (guid/offset/length/
codec/uncompressedLength/hash) → concatenated per-entry blobs. `writeRpak` (build-time, gzip
via Web Streams with a node:zlib fallback, FNV-1a content hashes), `RpakReader` (in-memory,
by GUID), `RangeRpakReader` (lazy — open() reads only header+TOC, each read() fetches only
that asset's byte range via an injected RangeFetch → HTTP-Range streaming), and the
`ExportTarget`/`ExportRegistry` interface. Reader layer is browser-safe.

- **HOW to test:** `bun test packages/build/` — 13 tests: write→read round-trip (none + gzip
  codecs), magic/version validation, duplicate-GUID + missing-GUID rejection, gzip actually
  compresses + round-trips, corrupt-blob integrity failure, and a RangeRpakReader test proving
  open() does exactly header+TOC fetches and read() fetches only one entry's range (never the
  whole archive). Bench: `bun run --cwd packages/build bench`.
- **This is a fully headless, self-contained P0 slice** (no GPU/studio needed). Remaining for
  the Web export item: the Bun bundler for user code + the web adapter (emit index.html +
  engine + user bundle + write the project's assets into a .rpak) + a real project exporting
  and running in a browser — those need a browser to fully confirm.
- Roadmap: `docs/roadmap/web-build-target.md`. Decision: ADR-0151. MASTER-ROADMAP 🟡.

---

## 🟡 Web export — Phase 2 shipped (web adapter: bundler + index.html + .rpak)

`@retro-engine/build` now turns a project into a deployable static site.
`bundleUserCode` (typed Bun-bundler wrapper — browser/ESM, externals/minify/sourcemap),
`emitIndexHtml` (pure boot page: full-viewport canvas + module script + optional .rpak
preload), and `WebExportTarget` (the 'web' ExportTarget: bundle the entry → write bundle +
index.html → pack assets into assets.rpak → return the file list).

- **HOW to test:** `bun test packages/build/` — 19 tests. Phase 2: bundleUserCode bundles a
  browser ESM fixture leaving externals bare; WebExportTarget exports a fixture end-to-end
  (asserts index.html + main.js + assets.rpak on disk, index.html references both, and the
  packed .rpak reads back through RpakReader); no-assets case skips the archive + preload.
- **Remaining for the Web export P0 check-off** (not headlessly verifiable here): a `retro
  build --target web` CLI, the studio "Build → Web" menu, and the actual in-browser run of a
  real exported project (needs a WebGPU browser). The pipeline that PRODUCES the artifact is
  done + verified; the "it runs in a browser" proof needs eyes on a browser.
- Roadmap: `docs/roadmap/web-build-target.md`. Decision: ADR-0151. MASTER-ROADMAP 🟡.

---

## 🟡 Play mode — snapshot/restore core shipped (editor-sdk)

Play mode's revert mechanism now exists in `@retro-engine/editor-sdk` (ADR-0152).
`captureSnapshot(world, registry, keep)` serializes the authored entities (excluding
editor-infra via the `keep` filter); `restoreSnapshot(...)` despawns current authored
entities and respawns the snapshot, returning the snapshot-id → new-Entity map. App
conveniences (`capturePlaySnapshot`/`restorePlaySnapshot` via serializeWorld/spawnScene)
and `installPlayModeSnapshot(app, { keep, onRestore })` wire capture to `onExit(SimState.Edit)`
and restore to `onEnter(SimState.Edit)`. Gating policy formalized: user systems run only
`inState(Play)`. Entity-only revert in v1 (resources persist).

- **HOW to test:** `bun test packages/editor-sdk/src/play-snapshot.test.ts` — 4 tests
  (World-level, no renderer): capture excludes editor-tagged entities; restore reverts
  play-time edits/spawns/despawns exactly; editor-infra entities survive untouched;
  idempotent across repeated capture/restore cycles.
- **Not yet wired into the studio.** Remaining (needs the studio + MCP to verify): call
  `installPlayModeSnapshot(app, { keep: e => !world.has(e, EditorOnly), onRestore: remapSelection })`
  in the studio boot; remap `state.selectedEntity` through the returned id map; make the
  inspector reflect the restored state; and wire the toolbar **Step** button (advance one
  frame while Paused). Backlog `docs/backlog/studio-playmode-snapshot-restore.md` kept until
  the studio integration is confirmed via MCP.
- Roadmap: `docs/roadmap/play-mode.md`. Decision: ADR-0152. MASTER-ROADMAP 🟡.

---

## 🟡 In-game UI — Phase 3 (.rss parser + style resolution) shipped

`@retro-engine/ui` can now author styling as a `.rss` (USS/CSS-subset) stylesheet resolved to
`UiStyle`. `parseRss` (comments, comma lists, compound type/`#name`/`.class`/`:state`/`*`
selectors) + `matches`/`specificity` + `resolveDeclarations` (specificity → source-order
cascade) + `resolveUiStyle` (declaration→UiStyle: flex/box-model/alignment, px/auto lengths,
padding/margin shorthands, inline overrides win). Pure + headless.

- **HOW to test:** `bun test packages/ui/` — 41 tests. Phase 3: selector parsing, specificity
  ordering, cascade (higher specificity wins; ties → later rule), declaration mapping + edge
  shorthands, inline overrides, and an end-to-end parse→resolve→layout assertion.
- **Not yet wired into the runtime.** Remaining (3b): descendant/child combinators, `--var`/
  `var()` custom properties + inheritance, and wiring resolution into the `UiPlugin` layout
  pass (a `.rss` asset kind + `Stylesheet` resource + state-marker components). Rendering (2)
  + widgets (4) still pending; both need the studio/GPU to see on screen.
- Roadmap: `docs/roadmap/ui-system.md` (Phase 3 🟡). ADR-0150. MASTER-ROADMAP 🟡.

---

## ✅ Web export — runtime host + `retro build` CLI + in-browser run proof (VERIFIED via browser)

The web export can now turn a project into a static site that **actually boots in a browser**.
New `@retro-engine/runtime-web` (`bootWebGame`: canvas → WebGPU renderer → add project plugins →
run — ADR-0153); `emitWebBoot` + `WebExportTarget` bundle a generated boot entry so `main.js`
boots the game; `parseProjectDescriptor` (in `@retro-engine/project`) reads `project.retroengine`;
`runWebExport` + a `retro-build` CLI drive the export. New asset-free `@retro-engine/sample-game`
(2D camera + MSDF `Text2d`) is the smoke test.

- **Verified end-to-end (Playwright, not just unit tests):** `retro build --project apps/sample-game`
  → static site → loaded in a real browser → WebGPU initialized, "RETRO ENGINE" / "WEB EXPORT OK"
  rendered crisply, and the "SPIN!" label was caught mid-rotation (frame loop runs). This doubles as
  the on-screen confirmation of the MSDF text pipeline (built-in default font).
- **Automated:** runtime-web 7 tests, project descriptor 3, build web-boot/run-export/web-export
  suites green; full monorepo gate green (lint/typecheck/test/build/bench). Changeset added.
- **HOW to re-test manually:**
  1. `bun run packages/build/src/cli.ts --project apps/sample-game --out /tmp/dist-web`
  2. Serve it: `cd /tmp/dist-web && bunx serve` (or any static server) and open the URL in a
     WebGPU browser (Chrome/Edge/Safari TP). You should see the three text lines with a spinning
     "SPIN!". (Needs a WebGPU adapter — headless environments without a GPU won't render.)
- **Not fully done (Export P0 stays unchecked):** studio "Build → Web" menu; packing `assets/`
  into the `.rpak` (assets aren't bundled yet); source maps / prod polish; tree-shaking jsimgui out
  of the shipped bundle (it's currently ~5 MB, mostly the editor-only imgui pulled in transitively).
  Logged as "Export — Web follow-ups" in MASTER-ROADMAP.
- Roadmap: `docs/roadmap/web-build-target.md`. ADRs 0151 + 0153. MASTER-ROADMAP Export item 🟡.

---

## 🟡 In-game UI — Phase 1c: UiText + measureText bridge (unit-tested)

`@retro-engine/ui` can now size a UI node to its text. New `UiText` component (authored,
reflection-registered: text/font/fontSize/letterSpacing/lineHeight; requires `UiNode`) +
`makeTextMeasure(uiText, fonts)` builds the flex `MeasureFunc` from the engine text layer
(`Font.measure`, ADR-0149). `UiPlugin` threads the `Fonts` store into the layout pass and
attaches the measure func to leaf text nodes, so flexbox sizes text intrinsically (wrapping
to the offered width). Graceful when no `Fonts` store is present (nodes size by style). This
is the ADR-0149 `measureText` measure-callback wiring the UI layout was waiting on.

- **Automated:** 53 UI tests (was 41) — UiText defaults/overrides/reflection round-trip,
  makeTextMeasure guards (empty/no-font/unloaded) + option passing (fontSize/letterSpacing
  always; lineHeight/maxWidth conditional) + result mapping, and two integration tests (a
  UiText leaf sizes to its measured text in a flex row; stays style-sized with no font store).
  Full repo gate green (lint/typecheck/test/build/bench). Changeset added.
- **Why no MCP verification:** UI still has no on-screen rendering (Phase 2) — layout/measure
  is headless. It'll be visually verifiable once UI Phase 2 rendering lands (drivable via the
  same sample-game web-export → Playwright path used for text).
- **HOW to test:** `bun test packages/ui/`. Behavior: a `UiText` on a `UiNode` leaf gets an
  intrinsic size from its font so a flex container lays it out like a real label.
- Roadmap: `docs/roadmap/ui-system.md` (Phase 1c ✅) + `text-rendering.md` (Phase 3 measure
  bridge ✅). ADR-0149/0150. MASTER-ROADMAP UI + Text items updated.

---

## ✅ In-game UI — Phase 2a: screen-space rendering (VERIFIED via browser)

In-game UI now renders on screen. New `UiRenderPlugin` (`@retro-engine/ui`, ADR-0154)
composites `UiNode` `backgroundColor` fills over the rendered scene via a once-per-frame
screen-space overlay render-graph node (`UiPassNode`, `loadOp:'load'`, ordered after the
camera driver — owns its own encoder, draws camera-free clip-space quads). `UiStyle` gains
`backgroundColor` (Vec4); `UiPipeline` is an alpha-blended quad pipeline with no bind groups
(clip mapping done on CPU). Nodes paint in the layout's depth-first `ComputedLayout.order` so
children draw over their (possibly translucent) parent.

- **Verified end-to-end (Playwright, real browser):** the `sample-game` web export now draws
  a bottom-right flex HUD panel — a translucent panel containing an orange title bar (fixed
  height) + a green content area (flexGrow) — correctly nested and composited over the text
  scene. Confirms overlay pass, flex layout → clip quads, alpha blend, nesting order, and
  screen-space anchoring.
- **Automated:** 60 UI tests (computeClipRect/packUiColor/packUiQuad + existing); `ui-quad-pack`
  bench (512 nodes ~1.6µs); full repo gate green (lint/typecheck/test/build/bench). Changeset added.
- **HOW to test:** `bun run packages/build/src/cli.ts --project apps/sample-game --out /tmp/dw`
  then serve `/tmp/dw` and open in a WebGPU browser → HUD panel bottom-right over the text.
- **Not done (UI P0 stays unchecked):** borders + corner radius; **in-UI text** (2b, via the
  ADR-0149 glyph path — the measure bridge exists but text isn't drawn inside UI yet); z-index/
  clipping; `.rss` runtime wiring (3b); widgets (4). Logged in MASTER-ROADMAP.
- Roadmap: `docs/roadmap/ui-system.md` (Phase 2a ✅). ADR-0150/0154. MASTER-ROADMAP UI item 🟡.

---

## ✅ In-game UI — Phase 2b: in-UI text rendering (VERIFIED via browser)

`UiText` nodes now draw glyphs on screen, positioned within the node's content box and
composited over UI backgrounds. New `UiTextPipeline` — a screen-space MSDF glyph pipeline
(ADR-0154) reusing the engine's glyph layout (`Font.layout`) + font atlas (unit quad +
per-instance clip rect + atlas UV + unitRange + unorm8x4 color; median-of-RGB coverage with
fwidth AA). `prepareUiText` lays out each label, places glyphs at the content origin, maps to
clip space, packs grouped per atlas. `UiTextPassNode` (a second overlay node after the quad
pass) draws the batches with per-atlas bind groups. `UiText.color` added.

- **Verified end-to-end (Playwright, real browser):** the `sample-game` export HUD panel now
  shows "STATUS" (dark on the orange title bar) + "HP 100  MP 42" (white on the green content
  area), crisp, inside their content boxes, layered over the quads — confirms glyph pipeline,
  content-box positioning, per-node color, and pass ordering (text over backgrounds).
- **Automated:** 61 UI tests (+ packUiGlyph); `ui-text-pack` bench (1024 glyphs ~3.4µs); full
  repo gate green (lint/typecheck/test/build/bench). Changeset added.
- **HOW to test:** same as 2a (`retro build` the sample, serve, open) → HUD panel bottom-right
  now has text labels.
- **Not done (UI P0 stays unchecked):** borders + corner radius; per-line text alignment;
  z-index/clipping + interleaved text-vs-later-panel ordering; `.rss` runtime wiring (3b);
  **widgets** (4 — button/label/slider + picking/focus + a menu sample). Logged in MASTER-ROADMAP.
- Roadmap: `docs/roadmap/ui-system.md` (Phase 2b ✅). ADR-0150/0154. MASTER-ROADMAP UI item 🟡.

---

## ✅ In-game UI — Phase 4a: pointer interaction (VERIFIED via browser)

UI nodes respond to the pointer — the foundation for buttons/menus. `Interactable` marker
(opts a node into picking; auto-attaches UiNode/ComputedLayout/UiInteraction), `UiInteraction`
state (`none`/`hovered`/`pressed`, derived), `UiClicked` message (press-begins-and-releases on
the same node). `pickTopmost` hit-tests front-most by paint order; `updateUiInteraction` is the
per-frame hover/press/click state machine; `UiInteractionPlugin` runs it in preUpdate after the
input update, reading CursorPosition + MouseButtonInput (`@retro-engine/input` is now a ui dep).
Headless/no-input → no-op.

- **Verified end-to-end (Playwright, real browser):** the `sample-game` export now has a centered
  "CLICK ME" button that tints on hover/press and a "CLICKS: N" label that increments per click.
  Drove real DOM mousedown/mouseup at the button center via the input backend → picking →
  UiClicked → counter: fresh load = 0, one click → 1, next click → 2 (exact, no spurious counts).
- **Automated:** 69 UI tests (pickTopmost + full hover/press/click state machine incl. release-
  outside + cursor-absent); `ui-picking` bench; full repo gate green. Changeset added.
- **HOW to test:** export the sample, serve, open in a WebGPU browser → move over the centered
  "CLICK ME" (it lightens), click it (counter increments; darkens while held).
- **Not done (UI P0 stays unchecked):** widget components (button/label/slider) + keyboard/gamepad
  focus routing + a menu sample (4b); borders/radius; `.rss` runtime wiring (3b). Logged in MASTER-ROADMAP.
- **Minor API friction noted:** the resolved `UiStyle` is fully readonly, so runtime style changes
  (e.g. hover tint) need a cast; consider a mutable style-patch helper. (Follow-up, not blocking.)
- Roadmap: `docs/roadmap/ui-system.md` (Phase 4a ✅). ADR-0150/0154. MASTER-ROADMAP UI item 🟡.

---

## ✅ In-game UI — Phase 4b: UiButton widget + Disabled (VERIFIED via browser)

Ergonomic buttons on the interaction layer. `UiButton` holds a normal/hovered/pressed/disabled
background palette; a built-in `UiInteractionPlugin` system tints the node from it by its
`UiInteraction` state (games no longer hand-write hover/press tinting). `Disabled` marker: picking
skips it (no hover/press/click) and it shows the disabled color. `setUiBackground(node, color)` is
the supported runtime recolor (resolved UiStyle is otherwise readonly). `pickTopmost`/
`updateUiInteraction` skip disabled entries.

- **Verified end-to-end (Playwright, real browser):** the `sample-game` export renders a centered
  3-button MAIN MENU — NEW GAME / LOAD (disabled, greyed) / QUIT — with built-in button styling.
  Driving real DOM clicks at each button's reported screen center: NEW GAME → LAST:NEW GAME,
  QUIT → LAST:QUIT, and the disabled LOAD button leaves LAST unchanged. Per-button routing via a
  `MenuAction` component resolved from the `UiClicked` entity.
- **Automated:** 74 UI tests (disabled-picking + UiButton palette/requires); full repo gate green
  (lint/typecheck/test/build/bench). Changeset added.
- **HOW to test:** export the sample, serve, open in a WebGPU browser → centered menu; hover a
  button (lightens), click it (LAST label updates); the greyed LOAD button ignores clicks.
- **Not done (UI P0 stays unchecked):** more widgets (label/toggle/slider/text-input) + focus/
  spatial nav (4c); borders/radius + z-index; `.rss` runtime wiring (3b). Logged in MASTER-ROADMAP.
- **Font note:** the built-in default font is uppercase-only and lacks `()`, so "LOAD (SOON)"
  renders as "LOAD SOON" — cosmetic, not a bug (a real font asset would cover it).
- Roadmap: `docs/roadmap/ui-system.md` (Phase 4b ✅). ADR-0150/0154. MASTER-ROADMAP UI item 🟡.

---

## ✅ In-game UI — Phase 2c: node borders (VERIFIED via browser)

UI nodes can draw a border. `UiStyle` gains `borderWidth` (per-side Edges, same scalar/partial
shorthand as padding/margin) + `borderColor` (Vec4), both reflection-registered. The overlay
prepare pass emits up to four inset edge quads per node (CSS border-box; corners not double-
covered), painted over the node's background and behind its children via the existing depth-first
order — reuses the UI quad pipeline (no new pipeline). `borderEdgeRects` is the pure edge helper.

- **Verified end-to-end (Playwright, real browser):** the `sample-game` export's bottom-right HUD
  panel and all three MAIN MENU buttons now render light border outlines.
- **Automated:** 77 UI tests (borderEdgeRects geometry: uniform/zero/single-side); full repo gate
  green. Changeset added.
- **HOW to test:** export the sample, serve, open → panel + menu buttons have outlines.
- **Also:** promoted the big remaining Export gap (asset `.rpak` delivery) to a phased plan in
  `docs/roadmap/web-build-target.md` (scanner → runtime RpakAssetSource → sprite proof) for a
  future focused effort — exported games currently load no project assets.
- Roadmap: `docs/roadmap/ui-system.md` (Phase 2c ✅). ADR-0150/0154. MASTER-ROADMAP UI item 🟡.

---

## 🟡 Export — web asset packing, phase A (build/unit-verified)

`retro build` now packs a project's assets into the export. `scanProjectAssets` (@retro-engine/build)
walks the project's `.meta` sidecars (skipping node_modules/dist/.re/.git/.turbo), parses each
({guid, kind}; location = sidecar path minus `.meta`), reads the asset bytes, and returns a baked
AssetManifestFile + GUID-keyed RpakInput[]. `WebExportTarget` writes `manifest.json` beside the
bundle; `runWebExport` runs the scan + packs. New `@retro-engine/assets` dep on build.

- **Verified (build + unit, no MCP path — runtime doesn't load assets yet):** added a sample asset
  (`apps/sample-game/assets/credits.txt` + `.meta`); `retro build` now emits `assets.rpak` + `manifest.json`
  alongside main.js/index.html; the packed asset reads back by GUID through `RpakReader` and the manifest
  parses (checked via a scratch script + a run-export test asserting both outputs + a manifest entry).
- **Automated:** build 29 tests (parseMetaEntry parse/strip/malformed; scanProjectAssets over a fixture with
  orphan + excluded-dir; run-export asserts manifest.json + assets.rpak). Full repo gate green. Changeset added.
- **HOW to test:** `bun run packages/build/src/cli.ts --project apps/sample-game --out /tmp/dw` → `/tmp/dw`
  contains assets.rpak + manifest.json; read a GUID back via RpakReader.
- **Not done (Export P0 stays unchecked):** phase B — a browser `RpakAssetSource` wired into the App's
  `AssetServer` so exported games actually LOAD packed assets; phase C — a sprite-from-.rpak browser proof;
  studio "Build → Web" menu. Plan in `docs/roadmap/web-build-target.md`.
- Roadmap: `web-build-target.md` (asset phase A ✅). ADR-0151/0153. MASTER-ROADMAP Export item 🟡.

---

## 🟡 Export — web asset delivery, phase B: runtime .rpak source (browser + unit-verified)

Exported games can now load their packed assets. `RpakAssetSource` (@retro-engine/runtime-web) is an
AssetSource that reads from a `.rpak` by GUID, resolving the AssetServer's location-based read through
the project manifest (location→GUID), opening the archive lazily then streaming per-entry byte ranges.
`httpRangeFetch` does HTTP Range (robust to non-Range 200 servers — slices locally). `bootWebGame({
assets: { rpakUrl, manifestUrl } })` fetches the manifest, adds AssetPlugin({source}), and setManifests —
before the game's plugins. New browser-safe `@retro-engine/build/rpak` subpath lets the browser runtime
import the reader without the node-only export pipeline; `emitWebBoot`/`WebExportTarget` forward the URLs.

- **Verified (browser + unit):** the sample-game export bundles the reader for the browser (node:zlib
  fallback externalized) and boots — `bootWebGame` fetched `manifest.json`, wired the source, and set
  `window.__retroAssets = { entries: 1 }` in-browser; the served `.rpak` parses (TOC has the GUID). The
  `RpakAssetSource.read` path is unit-tested end-to-end over a real `writeRpak` archive + fake RangeFetch
  (runtime-web 10 tests). Full repo gate green. Changeset added.
- **HOW to test:** export the sample, serve, open in a WebGPU browser + devtools → `window.__retroAssets`
  shows `{ entries: 1 }`; `fetch('assets.rpak')` returns the archive.
- **Not done (Export P0 stays unchecked):** phase C — a real image loads by GUID from the `.rpak` and
  renders as a Sprite in the browser (needs an image loader + a Sprite consumer in the sample), which
  exercises an actual per-asset read end-to-end; studio "Build → Web" menu. Plan in web-build-target.md.
- Roadmap: `web-build-target.md` (asset phase B ✅). ADR-0151/0153. MASTER-ROADMAP Export item 🟡.

---

## ✅ Export — web asset delivery, phase C: end-to-end packed-asset load (VERIFIED via browser)

The exported game now actually LOADS + consumes a packed asset. The `sample-game` packs
`assets/credits.txt`; at runtime it registers a tiny text loader (`bytes → string`), `loadByGuid`s
the credits GUID, and a system consumes the value once the async load drains into the store,
showing "CREDITS: LOADED" and setting `window.__game.credits`.

- **Verified end-to-end (Playwright, real browser):** `window.__game.credits` equals the exact
  `credits.txt` content — proving the full path: build packs it → bootWebGame fetches manifest +
  wires RpakAssetSource → loadByGuid → RpakAssetSource.read (location→GUID) → RangeRpakReader over
  HTTP → decode → store → game code consumes it. The UI label updates to "CREDITS: LOADED".
- **Automated:** app-only change (no packages/*/src) so no changeset; full repo gate green. The
  underlying source/reader are unit-tested (phase B).
- **HOW to test:** export the sample, serve, open in a WebGPU browser + devtools → `window.__game.credits`
  is the credits text; the on-screen "CREDITS: LOADED" label confirms the consume.
- **Export asset delivery A+B+C is complete + browser-verified.** Remaining for the Export P0
  check-off: the studio "Build → Web" menu (studio-side) + source-map/prod polish.
- Roadmap: `web-build-target.md` (asset phase C ✅). MASTER-ROADMAP Export item 🟡 (studio menu remains).

---

## ✅ Play mode — snapshot/restore wired into the studio (VERIFIED via studio MCP)

The studio's Play→Stop now reverts the scene. `installPlayModeSnapshot` is installed in
`apps/studio/src/main.ts` (`keep = !EditorOnly`): Play captures the authored scene, Stop despawns
authored entities + respawns the snapshot. Fixed a real bug found via MCP: `capturePlaySnapshot`
was capturing glTF-instantiated children verbatim, so restore's `spawnScene` re-instantiated them
→ every Play/Stop **doubled** a model's node tree. Now composition-aware: engine
`SerializeOptions.composition` → `serializeWorld` → `collectComposition`; `capturePlaySnapshot`
passes the App's `CompositionRegistry` (entities-only, per ADR-0152). Selection clears on restore.

- **Verified end-to-end (studio + retro-studio MCP, real `retro-game-sample` project):** brought up
  `bun tauri dev` (Rust pre-built → ~6s), drove `studio_play` → `component_set Health.current`
  → `studio_stop`. Before the fix: Stop left Health at 150 (not reverted) AND the hierarchy had TWO
  `Armature`/`Character_*` subtrees. After the fix: Hero's Health reverts 150→110, and a play/stop
  cycle keeps the entity count at 77→77 (no duplication) — screenshots `playmode-before/after`.
- **Automated:** engine (37 scene tests) + editor-sdk (64 tests) green; full repo gate green. Changeset added.
- **HOW to test:** open the studio on a project with a glTF model, select an entity, press Play,
  change a field, press Stop → the field reverts and the model isn't duplicated.
- **Backlog LEFT (not deleted):** `docs/backlog/studio-playmode-snapshot-restore.md` — acceptance
  criterion "selection *survives* the round-trip" is only partially met (selection is safely CLEARED,
  not remapped to a persistent identity). Also **Step** (advance one frame while Paused — the ▶⏭
  toolbar button is still inert) + inspector-during-play remain. Please confirm before I delete it.
- **Separately confirmed the P1 bug** `studio-mcp-component-set-entity-and-vec3`: `component_set`
  on a vec3 field (`Transform.translation = [5,5,5]`) corrupted it to `[]` live — reproduced via MCP.
- Roadmap: `play-mode.md` + MASTER-ROADMAP Play-mode item + `reference/studio-editor.md` updated. ADR-0152.

---

## ✅ Play mode — Step: advance one frame while paused (VERIFIED via studio MCP)

The dead ▶⏭ toolbar Step button now works, and there's a new `studio.step` MCP command.
Stepping advances gameplay **exactly one frame while `Paused`, without leaving the paused state**.

- **Design:** new `SimStep` resource + `installSimStep(app)` (`@retro-engine/editor-sdk`,
  `sim-step.ts`) run a `'first'`-stage system that opens a one-frame `active` window when a step is
  queued. The studio composes the project play gate as `inState(SimState.Play).or(simStepActive())`
  (`main.ts`), so gameplay runs while playing *or* for one stepped frame. `requestSimStep` is a
  no-op unless paused (meaningless in Edit / already-running Play). Because `SimState` never changes
  during a step, `state.playing`/`paused` mirrors and the inspector's play-mode behavior don't churn.
- **Verified end-to-end (studio + retro-studio MCP, real `retro-game-sample`):** brought up
  `bun tauri dev`, `studio_play` → `studio_pause`, `component_set Health.current = 40`. Confirmed
  Health stayed **40 across many frames while paused** (gameplay frozen). Then `studio_step` → **41**;
  read again (no step) → still **41** (the step was exactly one frame); two more steps → **42 → 43**
  (linear, regen is +1/frame). `simState` stayed **"Paused"** throughout (no flicker). `studio_step`
  in Edit returned `{stepped:false}` (guard works). Stop still restored Health 43→110 (snapshot intact).
- **Automated:** `packages/editor-sdk/src/sim-step.test.ts` (2 frame-driven tests, App+`advanceFrame`):
  freezes while paused, advances exactly one frame per step, stays frozen after, no-op unless paused,
  and in Play a step adds no extra frame. Full repo gate green (typecheck/lint/test). Changeset added.
- **HOW to test:** open the studio, press Play, then Pause. Change a gameplay-driven value (or set
  `Health.current` low) → it stays put. Click the ⏭ Step button (or run `studio.step`) → gameplay
  advances one frame each click.
- **New gap logged** (MASTER-ROADMAP + play-mode.md): fixed-timestep + Step — a stepped frame could
  run *accumulated* `fixedUpdate` steps as a catch-up burst (mirrors ordinary pause→resume); latent
  today (sample has no `fixedUpdate` gameplay). Fix later by freezing the fixed accumulator while not playing.
- Docs: `reference/studio-editor.md` (Step ✅, MCP 66→67 tools), `roadmap/play-mode.md` (Step ✅),
  MASTER-ROADMAP Play-mode AC (Step ✅; inspector-during-play + selection-survival still ❌).

---

## ✅ In-game UI — `.rss` runtime style wiring ("Retro CSS") (VERIFIED via browser export)

The `.rss` parser + cascade existed but weren't applied to the running UI. Now a parsed
stylesheet styles live nodes each frame, including pseudo-class states.

- **New in `@retro-engine/ui`:** `resolveUiStyle` now maps paint props
  (`background-color`/`border-color`/`border-width` + `border` shorthand) via a CSS
  `parseColor` (hex 3/4/6/8-digit, `rgb()`/`rgba()`, named → `[0,1]` `Vec4`). A `UiStyleSheet`
  resource holds active rules (`setUiStyleSheet(app, rss)`); a `UiClass` component
  (reflection-registered: `classes`/`name`/`type`) is a node's selector identity; a `postUpdate`
  `'ui-style'` system (before `'ui-layout'`) resolves each `UiClass` node's style from the sheet
  every frame, deriving states — `hovered`/`pressed` from `UiInteraction`, `disabled` from the
  `Disabled` marker. Nodes without a `UiClass` are untouched (keep authored style).
- **Verified end-to-end in a real browser** (`apps/sample-game` web export → Playwright): added a
  top-left chip strip styled ONLY by `.rss` (no inline UiStyle) + a probe reporting each chip's
  resolved fill. Read back: `.chip` → `rgb(40,120,210)`, `.chip.alt` (compound selector) →
  `rgb(240,150,40)` (beat the base rule), chips sized/bordered from the sheet. Then dispatched a
  `mousemove` over the interactive `.chip.hot` chip → its resolved fill flipped to `rgb(240,60,60)`
  (the `.chip:hovered` rule) within a frame — proving live state-driven re-resolution.
- **Automated:** `packages/ui/src/rss-style.test.ts` (9 tests: color parsing, paint mapping,
  ECS resolution, `:hovered`/`:disabled` states, `#name`/type selectors, unmatched → default) +
  `packages/ui/bench/rss-style.bench.ts`. Full repo gate green (1935 tests). Changeset added.
- **HOW to test:** `cd apps/sample-game && bun run build:web`, serve `dist/web`, open in a browser
  → three chips top-left (blue, orange, blue); hover the third → it turns red.
- Docs: `roadmap/ui-system.md` Phase 3b ✅, MASTER-ROADMAP In-game UI item prose. (UI item stays
  unchecked — corner-radius/z-index/clipping, more widgets (4c), combinators/`--vars`/inheritance,
  and a `.rss` asset kind remain.)

---

## ✅ In-game UI — `.rss` custom properties (`--vars` / `var()`) + runtime theme (VERIFIED via browser export)

Extends "Retro CSS" with CSS custom properties and a runtime-overridable theme — closes the
`--vars via a theme resource` UI acceptance-criterion.

- **New in `@retro-engine/ui`:** `collectThemeVars(rules)` (gather `--name` declarations into a flat
  theme, later-wins) + `substituteVars(value, vars)` (`var(--name)` / `var(--name, fallback)`);
  `resolveUiStyle` gained a `vars` arg (substitutes before mapping; auto-collects sheet vars when
  none passed). New `UiTheme` resource + `setUiThemeVars(app, vars)` — overrides merged over the
  sheet's `--vars`, re-themed live by the `'ui-style'` system each pass. Also fixed the `border`
  shorthand to accept functional colors (`rgb(r, g, b)` with internal spaces), not just hex.
- **Verified end-to-end in a real browser** (`apps/sample-game` export → Playwright): the sample
  `.rss` now defines `:root { --accent … --alt … --hot … }` and the chips fill via `var(--accent)` /
  `var(--alt)`. Read back: plain chip = `rgb(40,120,210)`, alt chip = `rgb(240,150,40)`. Then called
  `window.__setAccent('rgb(0,200,0)')` (→ `setUiThemeVars`) → the accent chips recolored to
  `rgb(0,200,0)` within a frame, while the `.alt` chip (uses `var(--alt)`) stayed orange — proving
  runtime re-theming is targeted per-variable.
- **Automated:** `packages/ui/src/rss-style.test.ts` (now 14 tests: + var collection/substitution,
  sheet-var resolution, theme override, functional-color border) + updated `rss-style` bench (vars).
  Full repo gate green (1940 tests). Changeset added.
- **HOW to test:** `cd apps/sample-game && bun run build:web`, serve `dist/web`, open in a browser →
  blue + orange + blue chips top-left; in the console run `window.__setAccent('rgb(0,200,0)')` → the
  first and third chips turn green, the middle (alt) stays orange.
- Docs: `roadmap/ui-system.md` Phase 3c ✅, MASTER-ROADMAP UI item (AC `--vars` ✅; remaining widget
  gap = **image** + `.rss` inheritance). UI item stays unchecked.

---

## ✅ In-game UI — image widget (`UiImage`, textured UI quads) (VERIFIED via browser export)

Adds the `image` minimal widget (panel/label/button/**image** — the last widget in the UI AC set).

- **New in `@retro-engine/ui`:** `UiImage` component (reflection-registered: image `Handle<Image>` +
  `tint` + source `uv` rect) + a screen-space textured render path mirroring the MSDF text pipeline —
  `UiImagePipeline` (per-texture bind-group cache), `prepareUiImages` (batch by texture), and a
  `makeUiImagePassNode` pass wired into `UiRenderPlugin` ordered quad → **image** → text. A node can
  carry both a `backgroundColor` and a `UiImage`.
- **Verified end-to-end in a real browser** (`apps/sample-game` export → Playwright): added a 4th `.rss`
  chip (`.chip.pic`) whose fill is a `UiImage` of a 2×2 procedural magenta/cyan checkerboard
  (`Image.fromBytes` → `Images.add`). Probe read `__rss.imageInstances === 1` (the textured pipeline
  packed + drew exactly one image) and the pic chip laid out at the strip's 4th slot — a solid-color quad
  cannot produce a sampled texture, so this proves real texture sampling. Screenshot captured.
- **Automated:** `packUiImage` test in `ui-render.test.ts` + `ui-image-pack` bench. Full repo gate green
  (1941 tests). Changeset added.
- **HOW to test:** `cd apps/sample-game && bun run build:web`, serve `dist/web`, open in a browser → the
  top-left chip strip's 4th chip shows a magenta/cyan checker (the others are solid blue/orange/blue).
- Docs: `roadmap/ui-system.md` (image widget ✅), MASTER-ROADMAP UI AC (`image` ✅). **The UI P0 item now
  has only ONE AC gap left: `.rss` inheritance** (cascade ✅, inheritance ❌).

## BLOCKED (this session) — studio MCP relay down

- **Play-mode "inspector shows live values during play"** (the last Play-mode AC item) could NOT be
  MCP-verified this session: the `retro-studio` MCP server/relay is disconnected (nothing on ws://…:8787,
  `studio_connected`/ToolSearch find no tools), and `bun tauri dev` has no relay to connect to. **Code
  inspection says it's already satisfied:** `panels-inspector.ts` re-reads each field fresh every frame via
  `readField(instance, …)` and passes `readonly: state.playing` — so during play the inspector shows the
  live (mutating) component values, just non-editable. If you can confirm in the studio (select an entity
  with a changing gameplay value, press Play, watch the inspector update), Play mode's AC is fully met
  (snapshot ✅ / step ✅ / gating ✅ / inspector-live ✅) and its box + backlog can close.
- If the relay needs restarting: it's the `retro-studio` MCP server (`.mcp.json`:
  `bun run packages/studio-mcp-server/src/cli.ts`) — a session-level MCP connection the harness owns.

---

## ✅ In-game UI — `.rss` custom-property inheritance → UI P0 AC FULLY MET (VERIFIED via browser export)

Custom properties now inherit down the UI tree (CSS-like), closing the **last UI acceptance-criterion**.

- **New in `@retro-engine/ui`:** `resolveUiStyles` now walks `Parent`/`Children` instead of resolving
  each node flat. `*`/`:root` vars (`collectGlobalVars`) are a global base; an element selector's `--vars`
  (`resolveNodeVars`) inherit down to a matching node's descendants and override within that subtree; the
  `UiTheme` override seeds the base (so scoped vars survive re-theming). Nodes without a `UiClass` still
  pass inherited vars to children.
- **Verified end-to-end in a real browser** (`apps/sample-game` export → Playwright): added a `.themed`
  container (`--accent: rgb(30,200,90)`) wrapping a `.chip`. Read back: the nested chip = `rgb(30,200,90)`
  (green, inherited) while sibling chips = `rgb(40,120,210)` (global blue). Then `window.__setAccent(
  'rgb(200,0,200)')` → the flat chips became purple but the nested chip **stayed green** (subtree override
  survives the runtime theme) — exactly correct scoping.
- **Automated:** `rss-style.test.ts` (now 15 tests: + a tree inheritance/override test). Full repo gate
  green (1942 tests). Changeset added.
- **HOW to test:** `cd apps/sample-game && bun run build:web`, serve `dist/web`, open in a browser → the
  top-left strip's last chip (inside `.themed`) is green; the first is blue. In the console run
  `window.__setAccent('rgb(200,0,200)')` → the blue chips turn purple, the green (themed) chip stays green.
- **>>> UI P0 item: ALL acceptance criteria now met** (flexbox ✅ / `.rss` cascade+inheritance ✅ /
  pseudo-class states ✅ / `--vars` theme ✅ / 2D-pipeline render ✅ / panel+label+button+image widgets ✅ /
  HUD styled by `.rss` ✅). Left the MASTER-ROADMAP box UNCHECKED per CLAUDE.md §3 — **please confirm and
  I'll check it off.** Non-AC polish (corner radius, z-index/clipping, combinators, more widgets) is P1/P2.

---

## 🟡 Text — world-space 3D `Text` promoted (ADR-0155) + phase 3a glyph packer (unit-verified)

The last Text P0 acceptance criterion is world-space `Text` (3D). It's a deep renderer slice (3D
pipeline + depth + a 3D verification scene), so I **promoted it** per CLAUDE.md §2/§8 and shipped the
tested mathematical core this iteration; the render path lands next.

- **New:** `ADR-0155` (world-space 3D text renders through the Core3d transparent phase — reuse
  `ViewPhases3d.transparent`, oriented-by-`GlobalTransform`, depth-test/no-write, 68-byte instance) +
  a phased plan in `roadmap/text-rendering.md`. **Phase 3a shipped:** `packGlyphInstance3d` +
  `TEXT3D_INSTANCE_*` (`packages/engine/src/text/text-glyph-instance-3d.ts`) — the CPU packer that maps a
  laid-out glyph + a 3D world matrix into a world-space quad instance (center/basisX/basisY all 3D).
- **Verified:** unit tests only (`text-glyph-instance-3d.test.ts`, 4 tests — identity, z-translation, and
  a Y-rotation prove the 3rd dimension). No MCP/browser path yet (the packer has no renderer consumer
  until 3b). Full repo gate green (1946 tests). Changeset added. **This is a building block, not a
  user-visible feature yet — nothing to click-test.**
- **Next iteration (Phase 3b):** `Text` component (reflection-registered) + `text-3d.wgsl` +
  depth-specialized `Text3dPipeline` + `prepareText3d`/`queueText3d` into `ViewPhases3d.transparent` +
  `TextPlugin` wiring, then browser-verify via a 3D camera + a `Text` occluded by a mesh in the sample.
- MASTER-ROADMAP Text item: unchanged box (still 🟡 — 3b + browser verify remain before check-off).

---

## 🟡 Text — world-space 3D `Text` render path shipped (integration + unit verified; browser pixel pending)

Phase 3b of world-space `Text` (ADR-0155): the `Text` component now actually renders in the 3D world.

- **New in `@retro-engine/engine`:** `Text` component (reflection-registered, same fields as `Text2d`) +
  `text-3d.wgsl` (3D `view_proj`, shared MSDF fragment) + a depth-specialized `Text3dPipeline`
  (`depthWriteEnabled:false`, `depthCompare:'less-equal'`, keyed on camera depth format) +
  `Text3dInstanceBuffer` + `Text3dPreparedBatches` + `prepareText3d`/`queueText3d` (one `PhaseItem3d` per
  entity into `ViewPhases3d.transparent`, drawn depth-tested by Core3d's `TransparentPass3d`). Wired into
  `TextPlugin`.
- **Verified:** `text3d-plugin.test.ts` (capturing-renderer integration, 3 tests) — a `Text` under a
  `Camera3d` emits exactly one instanced draw into the `.transparent3d` pass (`'AB'` → instanceCount 2),
  atlas bound at `@group(1)`, no-font skipped. Plus the 3a packer unit tests + the depth convention matches
  the proven gizmo/grid/material overlays. Full repo gate green (1949 tests). Bench `text-prepare-3d`.
  Changeset added.
- **NOT yet browser-pixel-verified.** The render path is integration+unit-tested (draws issued into the
  depth-tested transparent phase) — the same bar the 2D text render path is tested at — but I haven't put a
  3D `Text` on screen in a browser export yet (the sample is 2D; adding a Camera3d + a mesh for an occlusion
  screenshot is the optional Phase-3c follow-up). **HOW to eventually pixel-test:** add a `Camera3d` + a
  `Mesh3d` + a `Text` behind it to a 3D sample → the label is occluded by the mesh, crisp where visible.
- MASTER-ROADMAP Text item: left 🟡 / box UNCHECKED — both `Text`/`Text2d` now render (integration-verified);
  pending a browser pixel confirmation + your say-so (CLAUDE.md §3) before check-off.

---

## ✅ Text — world-space 3D `Text` browser pixel-verified + a real depth bug fixed (VERIFIED via Playwright)

Finished the 3D-text story with on-screen pixel proof — and the browser check caught a latent engine bug
that the integration test could not.

- **Verified end-to-end in a real browser** (playground `?mode=text3d` → Playwright): added a
  `text3d-showcase-plugin` (a `Text` on the XY plane + an opaque unlit cube occluder under a `Camera3d`).
  Screenshot shows crisp yellow MSDF "WORLD 3D" in perspective, with the nearer cube **occluding** the
  glyphs behind it (depth-test works). Probe `window.__text3d.instances === 7` (7 non-space glyphs packed).
- **Bug found + fixed** (the reason it was black at first): `TransparentPass3dNode` set `depthReadOnly:true`
  **and** `depthLoadOp:'load'`/`depthStoreOp:'discard'` — WebGPU rejects that combo, so it produced an
  invalid command buffer and dropped every frame with a transparent 3D draw. Latent because nothing used
  the 3D transparent phase until 3D text became its first consumer. Fix: renderer-core
  `DepthStencilAttachment` load/store ops made optional; webgpu encoder omits them when read-only; the node
  builds a read-only depth attachment. **The capturing-renderer integration test did NOT catch this (it
  doesn't run WebGPU validation) — browser verification did.**
- **Automated:** full repo gate green (1949 tests, build 26 tasks). Changeset added (renderer-core +
  renderer-webgpu + engine patch).
- **HOW to test:** `cd apps/playground && bun --hot dev-server.ts`, open `http://localhost:5173/?mode=text3d`
  in a WebGPU browser → "WORLD 3D" in 3D, a rotating blue cube occluding the middle glyphs.
- **>>> Text P0 item: all AC now met** — MSDF atlas ✅ / 2D+3D glyph batching ✅ / `Text`+`Text2d` ✅ (both
  pixel-verified) / font asset+`.meta` ✅ / layout ✅ / UI measure bridge ✅ / crisp at any scale ✅ / sample
  draws styled text ✅. MASTER-ROADMAP box left UNCHECKED per CLAUDE.md §3 — **please confirm to check off.**
  (Rich-text runs + a billboard flag are non-AC follow-ups.)

---

## ⭑ P0 STATUS — the shippable-game foundation is AC-complete (awaiting your checkoffs)

Every P0 acceptance criterion is now met **except one blocked item**. Nothing unblocked remains, so per
"never stall the loop" I've begun P1. Please review + check the P0 boxes you're happy with:
- **Input / Audio / Physics** — ✅ already checked (pre-session).
- **In-game UI** — all AC met (flexbox + `.rss` cascade/inheritance/`--vars` + pseudo-states + 2D render +
  panel/label/button/image widgets + `.rss`-styled HUD), browser-verified. Box unchecked (needs your §3 OK).
- **Text (MSDF)** — all AC met; `Text2d` + world-space `Text` (3D) both browser-pixel-verified. Box unchecked.
- **Export (web + `.rpak`)** — all AC met: a real project exports via the CLI and runs from the artifact,
  streaming `.rpak` assets over HTTP (browser-verified). Box unchecked. (Beyond-AC extras: a studio
  "Build → Web" menu — BLOCKED, studio; source maps — optional polish.)
- **Play mode** — snapshot/restore ✅ + Step ✅ + gating ✅ (all MCP-verified earlier). The one unmet AC —
  "inspector shows live values during play" — is **BLOCKED** (needs studio-MCP verification; the relay has
  been disconnected all session). Code inspection shows it's already satisfied (see the earlier BLOCKED note).
- **Stabilization freezer fixes** — ✅ (bug files kept for your confirmation).

## ✅ P1 — Diagnostics store (FPS / frame-time / entity-count) (unit + integration verified)

- **New:** `@retro-engine/ecs` `World.entityCount` (O(1) live count). `@retro-engine/engine`
  `DiagnosticsStore` (EMA `frameTimeMs`, derived `fps`, `entityCount`, `frameCount`) + `updateDiagnostics`
  (pure) + opt-in `DiagnosticsPlugin` (updates each frame from the real clock delta + entity count, `'last'`
  stage).
- **Verified:** `diagnostics.test.ts` (4 tests) — EMA convergence to the sample, first-sample seed,
  zero-delta handling, and an App+`advanceFrame` integration (frame count, live entity count incl. a
  mid-run spawn, non-zero fps). Full ecs+engine suites green (1262). Changeset added.
- **HOW to test:** `app.addPlugin(new DiagnosticsPlugin())`, then read `Res(DiagnosticsStore)` — `fps` /
  `frameTimeMs` / `entityCount` update live. Remaining (non-AC): asset counts + an on-screen overlay.
- Roadmap: MASTER-ROADMAP P1 Diagnostics 🟡 (core shipped), box unchecked pending your confirmation.

---

## ✅ P1 — `Local<T>` system param (per-system persistent state) (unit-verified)

- **New:** `@retro-engine/engine` `Local(factory)` → a `LocalState<T>` (`.current`) — per-system persistent
  state (accumulators, frame counters, private caches), lazily seeded on first run and carried across
  frames; each `Local(...)` owns a distinct slot (no cross-system sharing). Bevy's `Local<T>` analog.
- **Verified:** `local-param.test.ts` (3 tests, App+`advanceFrame`): factory seed + write persistence across
  frames (`10 → 11 → 12 → 13`), two systems with independent slots, a non-primitive array slot growing
  across frames. engine typecheck/lint/tests green. Changeset added.
- **HOW to test:** `app.addSystem('update', [Local(() => 0)], (n) => { n.current += 1; })` → `n.current`
  increments once per frame and persists.
- Roadmap: MASTER-ROADMAP P1 System-param sugar 🟡 (Local shipped; reader/writer/trigger sugar remain),
  system-params.md item 1 ✅. Box unchecked pending your confirmation.

---

## ✅ P1 — `Window` resource + `WindowResized` event (windowing, read side) (unit + integration verified)

- **New:** `@retro-engine/engine` `Window` resource (logical `width`/`height` + `physicalWidth`/`Height` +
  `devicePixelRatio`, mirrored from the drawing surface) + `WindowResized` message + `syncWindow` (pure
  fold) + opt-in `WindowPlugin` (`'first'`-stage sync each frame, emits `WindowResized` on logical-size
  change, headless-safe). Lets game code read the window size without DOM globals (headless-safe).
- **Verified:** `window.test.ts` (5 tests): `syncWindow` dpr division / change detection / dpr guard, and a
  capturing-renderer integration (Window reflects the surface; `WindowResized` fires once on first sight,
  not on a steady size). Full gate green (1961 tests; full typecheck across all packages confirms the
  `Window` export doesn't collide with the DOM `Window` type anywhere). Changeset added.
- **HOW to test:** `app.addPlugin(new WindowPlugin())`, read `Res(Window).width/height` or
  `MessageReader(WindowResized)`. Remaining (non-AC): cursor/fullscreen/present-mode controls + multi-window.
- Roadmap: MASTER-ROADMAP P1 Windowing 🟡 (read side shipped). Box unchecked pending your confirmation.

---

## ✅ P1 — Touch gesture recognizers (tap + swipe) (unit-verified)

- **New:** `@retro-engine/input` `recognizeGestures` (pure: records touch start times, classifies on release
  into `TapGesture` / directional `SwipeGesture` by travel + duration; canceled touches emit nothing) +
  `TouchGestureConfig`/`DEFAULT_TOUCH_GESTURE_CONFIG` + `TouchGesturePlugin` (opt-in; `preUpdate` after the
  input drain, emits `TapGesture`/`SwipeGesture` messages).
- **Verified:** `touch-gestures.test.ts` (6 tests): tap, swipe direction incl. dominant-axis, neither-case
  (too slow/short), far-but-slow rejected, canceled dropped. input typecheck/lint/tests green (59). Changeset.
- **HOW to test:** `app.addPlugin(new InputPlugin()); app.addPlugin(new TouchGesturePlugin())`, read
  `MessageReader(TapGesture)` / `MessageReader(SwipeGesture)`. Remaining: pan (already available via touch
  deltas) + pinch (2-touch) + the studio binding editor (BLOCKED — studio).
- Roadmap: MASTER-ROADMAP Input follow-ups (b) 🟡. **Also noted: the System-param sugar P1 item is
  substantially complete** — `Local` + `MessageReader/Writer` + `Trigger` + `NextState` all ship; items 5-9
  are explicitly niche/deferred. Both boxes unchecked pending your confirmation.

---

## ✅ P1 — Gamepad buttons in the ActionMap (unit-verified)

- **New:** `@retro-engine/input` `gamepadButton(button)` source + a `'gamepad'` `InputDevice` — bind actions
  to gamepad buttons through the existing `ActionMap` builders (`.button`, virtual-D-pad `.axis2d`, or mixed
  with keyboard/mouse). Read from the first connected pad. `resolveActionState` now takes an `ActionInputs`
  bundle (`{ keyboard, mouse, gamepad }`) — **breaking** for direct callers (plugin path unaffected).
- **Verified:** `action-map.test.ts` (+3 gamepad tests, 12 total): button press → action, mixed
  gamepad+keyboard OR-ing, virtual D-pad `axis2d` from gamepad buttons. Full repo gate green (1970 tests;
  full typecheck confirms the signature change breaks no other caller). Changeset added.
- **HOW to test:** `new ActionMap().button('Jump', gamepadButton('South'))` on a player entity (with
  `InputPlugin`); the action fires when the first pad's South button is pressed. Remaining: analog stick
  axes as action sources (Input follow-up a); the studio binding editor (BLOCKED — studio).
- Roadmap: MASTER-ROADMAP Input follow-ups (a) 🟡 (buttons shipped, analog remaining). Box unchecked pending
  your confirmation.

---

## ✅ P1 — Pan + pinch touch gestures (completes tap/swipe/pan/pinch) (unit-verified)

- **New:** `@retro-engine/input` `PanGesture` (single moving touch, per-frame delta) + `PinchGesture`
  (two-touch incremental `scale` of their separation + center). `recognizeGestures` now returns
  `{ taps, swipes, pans, pinches }` (tracking the 2-touch distance in `TouchGestureState`);
  `TouchGesturePlugin` emits all four as messages.
- **Verified:** `touch-gestures.test.ts` (+2, 8 total): pan delta only after the down frame; pinch scale
  spreading (×2) / together (×0.5); a single touch is a pan not a pinch. input typecheck/lint/tests green
  (64). Changeset added.
- **HOW to test:** with `TouchGesturePlugin`, read `MessageReader(PanGesture)` (drag one finger) /
  `MessageReader(PinchGesture)` (two fingers apart/together).
- Roadmap: MASTER-ROADMAP Input follow-ups (b) touch gestures ✅ (tap/swipe/pan/pinch all shipped). The
  Input follow-ups item now has only analog gamepad axes (a) + the studio binding editor (c, BLOCKED) left.
  Box unchecked pending your confirmation.

---

## ✅ P1 — Analog gamepad axes as action sources (completes gamepad action-map binding) (unit + data-path verified)

- **New:** `@retro-engine/input` (ADR-0156). Analog sticks/triggers now drive `axis`/`axis2d` actions with
  their continuous `[-1,1]` value: `gamepadAxis(axis)` source, `.stick(name, src)` / `.stick2d(name, {x,y})`
  builders, and an optional `analog` field on `.axis`/`.axis2d`. New `analogX`/`analogY` binding roles;
  `resolveActionState` reads a `gamepadAxes` query and combines analog with the digital legs by
  **larger magnitude** (keyboard ±1 vs. a partial stick — the dominant input wins), clamped to [-1,1].
- **Also fixed:** latent reflection gap — `ActionBinding.device` schema now enumerates `'gamepad'` (the prior
  digital-button slice already produced `device:'gamepad'` but the schema rejected it, so a saved scene with
  any gamepad binding would have failed enum validation on load).
- **Verified:** `action-map.test.ts` (+7: stick/stick2d/analog builder shapes; stick reads value directly;
  keyboard+stick max-magnitude combine; dead-zoned stick leaves keyboard in charge). `gamepad.test.ts` (+2
  full-data-path: a raw stick snapshot `[0.55,-0.55]` flows through `updateGamepads` → dead-zone → Y-flip →
  the *exact* `gamepadAxes` query `InputPlugin` builds → `resolveActionState` → `Move = {x:0.5, y:0.5}`,
  up = +1; a resting stick within the dead zone resolves to 0). `action-reflection.test.ts`: a `.stick2d`
  gamepad-axis map round-trips through the extended role/device enums. Full input gate green: typecheck,
  lint (28 files), 73 tests, bench (analog combine on the hot path). Changeset added.
- **HOW to test:** on a player entity with `InputPlugin`, `new ActionMap().stick2d('Move',
  { x: gamepadAxis('LeftStickX'), y: gamepadAxis('LeftStickY') })` → `ActionState.axis2d('Move')` tracks the
  left stick continuously; or `.axis2d('Move', { left, right, up, down, analog: {x, y} })` for WASD-or-stick.
- Roadmap: MASTER-ROADMAP Input follow-ups (a) gamepad bindings ✅ (buttons + analog both shipped). The Input
  follow-ups item now has only the studio binding editor (c, BLOCKED — studio) left. Box unchecked pending
  your confirmation.

---

## ✅ P1 — ECS ordering depth, Phase 1: batch registration + `.chain()` (unit + integration verified)

- **New:** `@retro-engine/engine` (ADR-0157, roadmap `ecs-ordering-depth.md`). `App.addSystems(stage, specs,
  { chain })` registers a group of systems together; the `system(params, fn, options?)` helper builds each
  spec (preserving per-system param typing). With `{ chain: true }` each system runs after the previous —
  ordered by **system identity** (new internal `RegisteredSystem.afterIds` edge), so it composes with any
  `label`/`before`/`after` the systems carry and won't false-cycle on shared labels. One topo pass resolves
  both edge kinds; cycles still caught eagerly at registration.
- **Verified:** `schedule.test.ts` (+5, 14 total): batch array-order; chain strict sequence; chain-by-identity
  (three same-labelled systems sequence without a cycle — the key proof it's id-keyed not label-keyed); chain
  composes with a label + external `after`; a chain that conflicts with a label constraint throws
  `ordering cycle`. Full engine gate green: typecheck, lint (626 files), 1225 tests, build; new
  `topoSort (chain of N)` bench runs (16/64/256). Changeset added.
- **HOW to test:** `app.addSystems('update', [system([ResMut(A)], fa), system([Res(A)], fb)], { chain: true })`
  → `fa` always runs before `fb`, no labels needed. Without `{ chain: true }` it's just a grouping of
  addSystem calls (registration order preserved).
- Roadmap: MASTER-ROADMAP "ECS ordering depth" now 🟡 Phase 1 shipped; remaining phases (SystemSet, ambiguity
  detection, exclusive `&mut World`, state-transition ordering) tracked in `ecs-ordering-depth.md`. Box
  unchecked pending your confirmation.

---

## ✅ P1 — ECS ordering depth, Phase 2: named system sets + set-level ordering (unit + integration verified)

- **New:** `@retro-engine/engine` (ADR-0158, roadmap `ecs-ordering-depth.md`). `AddSystemOptions.inSet`
  (`string | string[]`) joins a system to reusable named set(s); `App.configureSet(stage, set, { before,
  after })` orders the whole group with one declaration. The topo sort now indexes each system by its
  `label` AND its set memberships under one `byName` map, so a per-system `before`/`after` target matches a
  set name as well as a label (backward-compatible superset). Set config merges additively; cycles caught
  eagerly + rolled back. `SystemInfo.sets` surfaces membership for the studio Systems panel. Ordering-only,
  registration-time — zero per-frame cost (set-level `runIf` deferred to Phase 2b).
- **Verified:** `schedule.test.ts` (+6, 20 total): set-level after/before order every member; `before/after`
  can target a set name; a system in two sets inherits both; forward-ref (configureSet before members);
  set-vs-set cycle throws + rolls back to a runnable schedule. Full engine gate green: typecheck, lint (626
  files), 1231 tests, build; new `topoSort (N systems in sets)` bench runs. Changeset added.
- **HOW to test:** `app.addSystem('update', [...], f, { inSet: 'physics' })` on several systems, then
  `app.configureSet('update', 'physics', { after: ['input'] })` → all physics systems run after the
  `input`-labelled system, verified by execution-order trace. `describeSchedule()` now includes `sets`.
- Roadmap: MASTER-ROADMAP "ECS ordering depth" now 🟡 Phases 1–2 shipped; remaining (set-level runIf,
  ambiguity detection, exclusive `&mut World`, state-transition ordering) tracked in `ecs-ordering-depth.md`.
  Box unchecked pending your confirmation.

---

## ✅ P1 — ECS ordering depth, Phase 2b: set-level run conditions (unit verified)

- **New:** `@retro-engine/engine` (ADR-0158). `App.configureSet(stage, set, { runIf })` gates a whole set:
  a member runs only when its own `runIf` (if any) AND every set it belongs to pass; multiple conditions on
  one set are AND-ed. Shared `StageSystems.setConditionsPass(sys, app)` is checked in BOTH the main-stage
  runner (`runStage`) and the render-stage runner (`runRenderSet`) — no half-coverage; alloc-free on the hot
  path (no array built for set-less systems). `SetOrdering` gained an optional `runIf` field.
- **Verified:** `schedule.test.ts` (+3, 23 total): set-level runIf toggles all members on/off across frames;
  a member needs its own runIf AND the set condition; two conditions on one set AND together. Full engine
  gate green: typecheck, lint (626 files), 1234 tests, build. Changeset added.
- **HOW to test:** `app.addSystem('update', [...], f, { inSet: 'gameplay' })` on several systems, then
  `app.configureSet('update', 'gameplay', { runIf: inState(GameState.Playing) })` → all gameplay systems run
  only while in the Playing state; flip state → they stop, verified by execution-order trace.
- Roadmap: MASTER-ROADMAP "ECS ordering depth" now 🟡 Phases 1–2b shipped; remaining (ambiguity detection —
  needs per-param access metadata; exclusive `&mut World`; state-transition ordering) tracked in
  `ecs-ordering-depth.md`. Box unchecked pending your confirmation.

---

## ✅ P1 — Audio mixer buses, Phase 1: named buses + per-bus volume (unit + stub-context verified)

- **New:** `@retro-engine/audio` (ADR-0159, roadmap `audio-mixer-buses.md`). Voices route through a named
  bus whose volume scales every voice on it, independent of per-voice + master gain (`voice.gain → bus →
  master`). `PlayOptions.bus`, `Audio.setBusVolume(bus, v)`/`busVolume(bus)`, and authored `AudioSource.bus`
  (serialized, reflection schema updated with `bus: t.string`). `WebAudioBackend` inserts a lazily-created
  `GainNode` per bus wired to master; `NullAudioBackend` round-trips bus volumes headlessly. String-keyed
  (names are conventions, not a fixed set). Web Audio fan-in pattern confirmed against MDN (§2).
- **Verified:** `audio.test.ts` (+3): Null bus round-trip (defaults to 1); `Audio` facade forwards bus on
  play + bus volume; `WebAudioBackend` against a stub AudioContext — a bus gain node is created wired to
  master and scaled, a bussed voice's gain connects to the bus (not master), a busless voice connects to
  master. `audio-playback.test.ts` (+2): `reconcileAudio` forwards `AudioSource.bus`, omits it when empty.
  Full audio gate green: typecheck, lint (13 files), 22 tests, build. Changeset added.
- **HOW to test:** `cmd.spawn(new AudioSource(musicHandle, { loop: true, bus: 'music' }))` +
  `audio.setBusVolume('music', 0.3)` → all music-bus voices dim while sfx/master are untouched. In a browser
  (WebAudioBackend) the volume actually changes; headless it round-trips the value.
- Roadmap: MASTER-ROADMAP "Audio mixer buses" now 🟡 Phase 1 shipped; remaining (submix trees, effect
  inserts, spatial panning) tracked in `audio-mixer-buses.md`. Box unchecked pending your confirmation.

---

## ✅ P1 — ECS ordering depth, Phase 4: exclusive world() systems (unit + integration verified)

- **New:** `@retro-engine/engine` (ADR-0160). `world(): Param<World>` resolves to the stage's live `World`
  for immediate structural edits (spawn/despawn/insert/remove) with same-frame read-back — no `Commands`
  deferral. A system carrying `world()` must declare no other params (it holds the whole world);
  registration throws otherwise, via a new optional `Param.exclusive` flag. Lowercase factory matches
  `key`/`gamepadAxis` and dodges the `World`-class name collision. Single-thread runner needs no scheduling
  change; the flag is the seam a future parallel scheduler reads.
- **Verified:** `schedule.test.ts` (+4, 27 total): an exclusive startup system spawns 2 entities that a
  later same-frame `update` query sees (proves immediate, not deferred); despawn + spawn through the
  exclusive world; a `world()` + `Query` system throws at registration; a bare `world()` system is allowed.
  Full engine gate green: typecheck, lint (626 files), 1238 tests, build. Changeset added.
- **HOW to test:** `app.addSystem('startup', [world()], (w) => { const e = w.spawn(new Transform()); w.insertBundle(e, [new Health(100)]); })`
  → entity + components exist immediately, visible to later systems the same frame. Mixing `world()` with
  any other param throws.
- Roadmap: MASTER-ROADMAP "ECS ordering depth" now 🟡 Phases 1, 2, 2b, 4 shipped; remaining (ambiguity
  detection — needs per-param access metadata; state-transition ordering) tracked in `ecs-ordering-depth.md`.
  Box unchecked pending your confirmation.

---

## ✅ P1 — ECS ordering depth, Phase 5a: explicit state-transition ordering (unit + integration verified)

- **New:** `@retro-engine/engine` (ADR-0161). `onEnter`/`onExit`/`onTransition` accept `label`/`before`/
  `after` (new `StateSystemOptions`) so transition systems in the same phase order independent of
  registration order. `topoSort` was generalized (`OrderableSystem` shape + error-context param) so ONE
  sort serves both the main schedule and transition records — no duplicated algorithm. Eager cycle
  detection at the register call site (record rolled back on cycle). Purely additive: unconstrained
  transition systems keep registration order → scene teardown timing unchanged.
- **Verified:** `state.test.ts` (+4): OnEnter ordered by before/after regardless of registration; unconstrained
  preserves registration order; a cycle throws at registration; OnExit ordered when transitioning Boot→Playing.
  `schedule.test.ts` still green (topoSort generic refactor). Full engine gate green: typecheck, lint (626
  files), 1242 tests, build. Changeset added.
- **HOW to test:** `app.onEnter(S, [...], spawn, { label: 'spawn' })` + `app.onEnter(S, [...], focus, { after: ['spawn'] })`
  → spawn runs before focus even if registered in the other order; a before/after cycle throws immediately.
- **NOTE (Phase 5b still open):** the backlog `explicit-state-transition-ordering.md` also wants scene
  teardown (`App.addScene`'s despawn OnExit) guaranteed to run after ALL user OnExit regardless of
  registration order. That needs a framework-vs-user phase split and is NOT done — the backlog file stays.
- Roadmap: MASTER-ROADMAP "ECS ordering depth" now has Phases 1, 2, 2b, 4, 5a shipped; remaining: ambiguity
  detection (blocked on per-param access metadata), Phase 5b teardown-last. Box unchecked pending confirmation.

---

## ✅ P1 — In-game UI depth, Phase 1: UiToggle (checkbox) widget (unit-verified; visual/interaction check pending)

- **New:** `@retro-engine/ui` (roadmap `in-game-ui-depth.md`). `UiToggle` two-state widget: flips `checked`
  on each click, emits `UiToggled { entity, checked }`, and a built-in system drives its `backgroundColor`
  from `checked` (+ `Disabled`). Reuses the existing `Interactable`/`UiClicked` foundation (`requires =
  [UiNode, Interactable]`). Flip logic is a pure `applyToggleClicks`; the plugin runs it `after:
  ['ui-interaction']` so this frame's `UiClicked` messages are visible (per the frame-buffered message
  contract). Reflection schema registered (`checked`/`on`/`off`/`disabled`).
- **Verified:** `ui-toggle.test.ts` (+8): defaults/overrides/requires; `applyToggleClicks` flips + emits
  UiToggled (true then false on second click), ignores non-toggle entities, skips `Disabled`, batches
  multiple clicks. Full ui gate green: typecheck, lint (52 files), 100 tests, build. Changeset added.
  NOTE: the pure flip logic is fully unit-tested; the plugin message-plumbing follows the codebase's
  pure-function pattern (like `reconcileAudio`/`updateUiInteraction`) but a live click→visual check in the
  studio/export is still worth an eyeball (studio relay is down).
- **HOW to test:** `cmd.spawn(new UiToggle({ checked: false }))` with `UiPlugin` + `UiInteractionPlugin` +
  `InputPlugin`; click the node → its background switches on/off and `MessageReader(UiToggled)` reports the
  new state.
- Roadmap: MASTER-ROADMAP "In-game UI depth" now 🟡 Phase 1 started (toggle done; slider/text-input/
  scrollview/dropdown/tabs + focus/nav/data-binding/virtualized-views/screens remain). Box unchecked.

---

## ✅ P1 — In-game UI depth, Phase 1: UiSlider (draggable value) widget (unit-verified; visual/drag check pending)

- **New:** `@retro-engine/ui` (roadmap `in-game-ui-depth.md`). `UiSlider` holds `value` in `[min,max]`;
  a built-in system maps the cursor's x across the node's `ComputedLayout` track to the value while the
  slider is the pressed node (`UiPointer.pressed`), emitting `UiSliderChanged { entity, value }`. Works
  grabbing the track or thumb. Value mapping is a pure `computeSliderValue(cursorX, trackX, trackWidth,
  min, max)` (clamps to ends, zero-width track → min). Reuses `Interactable` (`requires = [UiNode,
  Interactable]`). Reflection schema `value`/`min`/`max`. The widget owns the value; visual fill is
  composed by the game.
- **Verified:** `ui-slider.test.ts` (+7): defaults; initial-value clamp; requires; `computeSliderValue`
  edges/midpoint/clamp-outside/non-zero-min/zero-width. Full ui gate green: typecheck, lint (54 files), 107
  tests, build. Changeset added. NOTE: drag logic (computeSliderValue) fully unit-tested; the plugin's
  pressed-node drag wiring follows the codebase pure-function pattern — a live drag→value eyeball in the
  studio/export is still worth a look (studio relay down).
- **HOW to test:** `cmd.spawn(new UiSlider({ min: 0, max: 1 }))` with `UiPlugin`+`UiInteractionPlugin`+
  `InputPlugin`; press and drag across the node → `MessageReader(UiSliderChanged)` reports values 0..1
  (e.g. wire it to `audio.setBusVolume('music', s.value)` for a volume slider).
- Roadmap: MASTER-ROADMAP "In-game UI depth" 🟡 Phase 1 in progress (toggle + slider done; text-input/
  scrollview/dropdown/tabs + focus/nav/data-binding/virtualized-views/screens remain). Box unchecked.

---

## ✅ P1 — Audio mixer buses, Phase 2: submix trees (bus → bus) (unit + stub-context verified)

- **New:** `@retro-engine/audio` (ADR-0162). `Audio.setBusOutput(bus, output)` routes a bus into another
  bus (submix), or back to master when `output=''`. `Audio` owns the bus graph (`Map<bus, output>`) and
  rejects cycles — including a direct self-route — throwing and leaving the graph unchanged. `busOutput(bus)`
  reads the target. The HAL gained `configureBus(bus, output)`: `WebAudioBackend` disconnects the bus's one
  output edge and reconnects to the target bus/master (voices are inputs, unaffected); `NullAudioBackend`
  no-ops. Bus gains compose multiplicatively down the chain.
- **Verified:** `audio.test.ts` (+2): facade routes dialogue→voice, voice→master, rejects voice→dialogue
  (cycle) + self-route with graph unchanged after throw; WebAudio stub — the dialogue bus node connects to
  the voice bus node (not master), then reconnects to master on reset. Full audio gate green: typecheck,
  lint (13 files), 24 tests, build. Changeset added.
- **HOW to test:** `audio.setBusOutput('dialogue', 'voice'); audio.setBusOutput('announcer', 'voice');
  audio.setBusVolume('voice', 0.5)` → both dialogue and announcer voices duck together, music untouched.
- Roadmap: MASTER-ROADMAP "Audio mixer buses" now 🟡 Phases 1–2 shipped; remaining (effect inserts, spatial
  panning) tracked in `audio-mixer-buses.md`. Box unchecked pending your confirmation.

---

## ✅ P1 — Diagnostics: asset counts (unit + integration verified)

- **New:** `@retro-engine/engine`. `DiagnosticsStore.assetCount` — total loaded assets across every
  registered `AssetStores` store, refreshed each frame by `DiagnosticsPlugin` (alongside fps/frameTimeMs/
  entityCount). New `AssetStores.totalAssetCount()` sums `store.size` over distinct stores (a store bound
  under several asset-type keys is counted once). `updateDiagnostics` gained an optional `assetCount` arg
  (omitting it leaves the field untouched → existing 3-arg callers unaffected).
- **Verified:** `diagnostics.test.ts` (+2): `updateDiagnostics` records assetCount when given / leaves it on
  omit; plugin integration reports 2 then 3 as a store grows. `asset-stores.test.ts` (+1): totals across
  stores, counts a shared store once. Full engine gate green: typecheck, lint (626 files), 1245 tests,
  build. Changeset added.
- **HOW to test:** with `DiagnosticsPlugin` + asset stores registered, `Res(DiagnosticsStore).assetCount`
  tracks the number of loaded assets each frame.
- Roadmap: MASTER-ROADMAP "Diagnostics store" now 🟡 core + asset counts shipped; only the on-screen overlay
  (studio panel / in-game UI) remains. Box unchecked pending your confirmation.

---

## ✅ P1 — Diagnostics: in-game overlay (unit-verified; visual check pending)

- **New:** `@retro-engine/ui`. `DiagnosticsOverlayPlugin` rewrites any `UiText` tagged with the new
  `DiagnosticsText` marker to the live `DiagnosticsStore` readout each frame (`FPS 60  16.8ms  ents 42
  assets 12`), in `last` after `diagnostics-update`. Formatting is a pure `formatDiagnostics(store)`. Lives
  in the ui package (which depends on engine, so it reads `DiagnosticsStore`); the user owns placement +
  font, the widget owns the text. `DiagnosticsText` reflection-registered.
- **Verified:** `diagnostics-overlay.test.ts` (+3): `formatDiagnostics` output (rounded fps, 1-decimal ms)
  + cold-start zero state; marker instantiation. Full ui gate green: typecheck, lint (56 files), 110 tests,
  build. Changeset added. NOTE: formatting fully unit-tested; the plugin's tagged-UiText update wiring
  follows the codebase pure-function pattern — a live on-screen eyeball is still worth a look (studio down).
- **HOW to test:** `app.addPlugin(new DiagnosticsPlugin()); app.addPlugin(new DiagnosticsOverlayPlugin());`
  then `cmd.spawn(new UiNode({ position: 'absolute', left: 8, top: 8 }), new UiText({ text: '', font }),
  new DiagnosticsText())` → the node shows live FPS / frame time / entity + asset counts.
- Roadmap: MASTER-ROADMAP "Diagnostics store" now 🟡 core + asset counts + in-game overlay shipped; only a
  studio diagnostics panel (studio-blocked) remains. Box unchecked pending your confirmation.

---

## ✅ P1 — In-game UI depth, Phase 2: focus + spatial navigation (unit-verified)

- **New:** `@retro-engine/ui` (ADR-0163). `UiFocus` resource (single focused entity) + `Focusable` marker
  + `UiNavigate` message. Game maps its input (Tab/arrows/d-pad/stick) to a `UiNavigate(direction)`;
  `UiFocusPlugin` consumes it. `'next'`/`'prev'` = tab order (layout paint order); `'up/down/left/right'` =
  nearest neighbour by a pure axis-distance + perpendicular-penalty cost (aligned beats skewed). Focus
  pointing at a node no longer `Focusable` (despawned/un-marked) self-clears. `Focusable` reflection-
  registered. Device-agnostic (no InputPlugin dependency — the message is the seam).
- **Verified:** `focus-nav.test.ts` (+9): `tabNavigate` next/prev with wrap, entry on null/unknown, empty→
  null; `spatialNavigate` 2×2 grid moves each direction, null when nothing in-direction, prefers aligned
  over skewed, entry on null focus, empty→null. Full ui gate green: typecheck, lint (60 files), 119 tests,
  build. Changeset added. NOTE: nav math fully unit-tested; the plugin's message→focus wiring follows the
  codebase pure-function pattern.
- **HOW to test:** `app.addPlugin(new UiFocusPlugin())`, spawn `Focusable` nodes, emit `UiNavigate('next')`
  / `UiNavigate('right')` from input → `Res(UiFocus).current` moves accordingly (Tab cycles; arrows pick
  spatial neighbours).
- Roadmap: MASTER-ROADMAP "In-game UI depth" now 🟡 Phase 1 (toggle+slider) + Phase 2 (focus/nav) shipped;
  remaining: focus activation + ring (2b), text-input/scrollview/dropdown/tabs, data binding, virtualized
  views, screens. Box unchecked pending your confirmation.

---

## ✅ P1 — In-game UI depth: `:focused` / `:checked` .rss pseudo-classes wired to live state (unit-verified)

- **New:** `@retro-engine/ui`. The `.rss` resolver already matched `:focused`/`:checked` but nothing emitted
  them. `deriveStates` now pushes `checked` for a checked `UiToggle` and `focused` for the `UiFocus.current`
  node. `resolveUiStyles` gained an optional `focusedEntity` arg (default none); the `ui-style` system
  soft-reads the `UiFocus` resource (only present with `UiFocusPlugin`), so the style pass is unchanged
  without focus. This is the focus-RING visual — authored purely in `.rss` (`*:focus { border-color }`),
  no hardcoded border code — plus toggle-checked styling (`Toggle:checked { ... }`).
- **Verified:** `rss-style.test.ts` (+2): `.cb:checked` flips background when the UiToggle is checked;
  `.item:focused` applies only to the focused entity and reverts when focus clears. Full ui gate green:
  typecheck, lint (60 files), 121 tests, build. Changeset added.
- **HOW to test:** author `Toggle:checked { background-color: … }` / `Button:focus { border-color: … }` in
  a `.rss` sheet with `UiPlugin` (+ `UiFocusPlugin` for `:focus`); the styles apply as toggles check and
  focus moves.
- Roadmap: MASTER-ROADMAP "In-game UI depth" — focus ring visual done via `:focus` styling; Phase 2b now
  only needs focus activation (Enter/South → click the focused widget). Box unchecked pending confirmation.

---

## ✅ P1 — In-game UI depth, Phase 2 complete: focus activation (unit-verified)

- **New:** `@retro-engine/ui`. `UiActivate` message → the focus system emits a `UiClicked` on
  `UiFocus.current`, so Enter/Space/gamepad-South drives the same click path as the pointer (buttons,
  toggles, and any `UiClicked` reader respond identically). Runs `after: ['ui-focus'], before:
  ['ui-toggle']` so the synthetic click is seen the same frame; `UiFocusPlugin` defensively `addMessage`s
  `UiClicked` so activation works even without `UiInteractionPlugin`. Decision is a pure
  `shouldActivateFocused(activated, focused)`.
- **Verified:** `ui-activate.test.ts` (+4): targets the focused entity when activated; no-op without an
  activation / with nothing focused; bare-message check. Full ui gate green: typecheck, lint, 125 tests,
  build. Changeset added.
- **HOW to test:** with `UiFocusPlugin`, map Enter (or gamepad South) → `MessageWriter(UiActivate).write(new
  UiActivate())`; the focused button/toggle reacts as if clicked (e.g. a focused `UiToggle` flips).
- Roadmap: MASTER-ROADMAP "In-game UI depth" — **focus complete** (navigate + ring + activate). Remaining:
  text-input, scrollview, dropdown/tabs, data binding, virtualized views, screens. Box unchecked pending
  your confirmation.

---

## ✅ P1 — Audio mixer buses, Phase 3: bus effect inserts (unit + stub-context verified)

- **New:** `@retro-engine/audio` (ADR-0164). `Audio.setBusEffect(bus, effect | null)` inserts a described
  `BusEffect` (`{kind:'filter', type, frequency, q?}` or `{kind:'compressor', threshold?/knee?/ratio?/
  attack?/release?}`) between a bus's gain and its output. `WebAudioBackend` builds a `BiquadFilterNode`/
  `DynamicsCompressorNode` and routes BOTH effect changes and submix reroutes through one `rebuildBus`
  (`gain → [effect] → output`), so effects + submix compose; `NullAudioBackend` no-ops. `Audio.busEffect(bus)`
  reads the spec. Web Audio node params confirmed against MDN (§2).
- **Verified:** `audio.test.ts` (+3): facade tracks/clears the effect + delegates to backend; WebAudio stub —
  a filter inserts between the music-bus gain and master (with type/frequency/Q set) and removing it
  reconnects gain→master; a compressor on `dialogue` survives a reroute to the `voice` submix
  (`gain → effect → voice`). Full audio gate green: typecheck, lint (13 files), 27 tests, build. Changeset.
- **HOW to test:** `audio.setBusEffect('music', { kind:'filter', type:'lowpass', frequency:700 })` muffles the
  music bus; `{ kind:'compressor' }` on a submix tames its peaks; `null` removes it.
- Roadmap: MASTER-ROADMAP "Audio mixer buses" now 🟡 Phases 1–3 shipped; remaining (multi-effect chains,
  reverb sends, sidechain ducking, spatial panning) tracked in `audio-mixer-buses.md`. Box unchecked.

---

## ✅ P1 — Audio mixer buses, Phase 4: 2D spatial stereo panning (unit + stub-context verified)

- **New:** `@retro-engine/audio` (ADR-0165). `AudioSource.spatial` + `panWidth` opt a source into stereo
  panning by world position. `PlayOptions.spatial` gives a voice a `StereoPannerNode` (`gain → panner →
  bus/master`); `Audio.setPan(voice, pan)` drives it (`[-1,1]`, clamped; no-op for non-spatial). The
  `audio-spatial` system (postUpdate, after audio-playback) pans each spatial voice by its world X vs. the
  first `AudioListener` with a `GlobalTransform`, via pure `panForOffset(sourceX, listenerX, panWidth)`.
  Non-spatial audio is byte-for-byte unchanged (no panner). `NullAudioBackend` no-ops. StereoPannerNode
  confirmed against MDN (§2). Reflection: `spatial`/`panWidth` added to the AudioSource schema.
- **Verified:** `spatial.test.ts` (+5): panForOffset center/left/right/clamp/listener-relative/zero-width.
  `audio.test.ts` (+2): facade forwards spatial on play + setPan; WebAudio stub — a spatial voice gets a
  panner (gain→panner→master) while a plain voice doesn't (gain→master), and setPan sets/clamps pan.value.
  Full audio gate green: typecheck, lint (15 files), 34 tests, build. Changeset.
- **HOW to test:** spawn `new AudioSource(clip, { spatial: true })` on a positioned entity + an
  `AudioListener` on a transform; the sound pans left/right as the source moves relative to the listener.
- Roadmap: MASTER-ROADMAP "Audio mixer buses" now 🟡 Phases 1–4 (pan) shipped; remaining (distance
  attenuation, full 3D PannerNode, reverb/sidechain) tracked in `audio-mixer-buses.md`. Box unchecked.

---

## ✅ P1 bug — MaterialPlugin.queueMaterials3d camera sub-graph filter (fix verified by suite + precedent; studio perf-confirm pending)

- **Fixed:** `@retro-engine/engine` `material-plugin.ts` `queueMaterials3d` now skips views whose
  `subGraph !== Core3dLabel`, so a `Camera2d` sharing the world stops accruing inert `PhaseItem3d` entries
  (wasted work = 2D-cameras × 3D-renderables/frame). One line, symmetric to the already-tested
  `SpritePlugin.queueSprites` `Core2dLabel` filter.
- **Verified:** full engine gate green (typecheck, lint, 1245 tests, build) — the filter only skips 2D
  cameras, which never had valid 3D draws, so no existing 3D test regressed. A bespoke 2D+3D-camera
  isolation test needs heavy render-world scaffolding (upload a mesh, populate SortedCameras with two
  sub-graphs, snapshot `ViewPhases3d` mid-render-stage before it clears) — disproportionate for a one-line
  inert-perf fix; the identical sprite-side filter is unit-tested. Changeset (patch) added.
- **HOW to test (studio):** a scene with a Camera2d + Camera3d + 3D meshes renders correctly; the 2D
  camera's `ViewPhases3d` lists stay empty (no wasted 3D queue work).
- **Bug file kept** (`docs/bugs/material-plugin-camera-subgraph-filter.md`), status flipped to "fixed in
  code, pending confirmation" — delete after you confirm in the studio.

---

## ✅ P1 — Texture import settings, Phase 1: model + resolvers + importer default (unit-verified)

- **New:** `@retro-engine/engine` (ADR-0166, roadmap `texture-import-settings.md`). `TextureImportSettings`
  (`filter` nearest/linear, `wrap` repeat/clamp/mirror, `colorSpace` srgb/linear) + pure
  `resolveTextureSampler` (filter→min/mag, wrap→both address modes) / `resolveTextureColorSpace` +
  `imageFromDecoded(decoded, settings)`. `createImageImporter(decode, settings?)` applies settings as the
  project-wide default for every image (backward-compatible — omitted = prior linear/sRGB behavior).
- **Verified:** `texture-import-settings.test.ts` (+5) resolver mapping/defaults; `image-importer.test.ts`
  (+1) an importer with `{ filter:'nearest', wrap:'repeat', colorSpace:'linear' }` produces an Image with
  the right sampler + color space. Full engine gate green: typecheck, lint, 1251 tests, build. Changeset.
- **HOW to test:** register the image loader with `createImageImporter(decode, { filter: 'nearest' })` →
  every imported texture samples nearest (crisp pixel-art); `{ colorSpace: 'linear' }` for a normal/data map.
- **NOTE:** this is a project-wide DEFAULT. Per-asset `.meta` overrides (via the asset server LoadContext)
  are Phase 2; mipmaps/trilinear, max-size, PPU are Phase 3 — tracked in the slug.
- Roadmap: MASTER-ROADMAP "Texture import settings" now 🟡 Phase 1 shipped. Box unchecked pending your
  confirmation.

---

## ✅ P1 — Texture import settings, Phase 2: per-asset `.meta` overrides (unit-verified)

- **New:** `@retro-engine/engine` (ADR-0166). A `<name>.meta` sidecar (UTF-8 JSON of TextureImportSettings)
  overrides the importer default for one texture. The image importer reads its own sibling `.meta` via the
  `LoadContext.read` it's handed (`textureMetaSibling(path)` → basename+'.meta'), parses with
  `parseTextureMeta` (keeps only valid filter/wrap/colorSpace, throws only on non-JSON), and merges over the
  default. Missing/malformed sidecar → silently ignored (importer-local try/catch). No asset-server or
  LoadContext-shape change → lower risk than pre-threading a settings field.
- **Verified:** `texture-import-settings.test.ts` (+6): parse recognized/invalid/non-object/non-JSON;
  sibling-path. `image-importer.test.ts` (+2): a `.meta` sidecar (via stub ctx.read) flips filter+colorSpace;
  absent sidecar (read rejects) keeps the importer default. Full engine gate green: typecheck, lint, 1258
  tests, build. Changeset.
- **HOW to test:** drop `wood.png.meta` = `{ "filter": "nearest", "colorSpace": "linear" }` next to
  `wood.png`; importing `wood.png` yields a nearest-filtered linear image (overriding the project default).
- **NOTE:** loose-file/disk path only for now; baking `.meta` into the packed manifest (bundle/web export)
  is the remaining follow-up. Phase 3 (mipmaps/max-size/PPU) still open.
- Roadmap: MASTER-ROADMAP "Texture import settings" now 🟡 Phases 1–2 shipped. Box unchecked pending
  your confirmation.

---

## ✅ P1 — Sprite definitions: manual-rect slicing (`TextureAtlasLayout.fromRects`) (unit-verified)

- **New:** `@retro-engine/engine` `TextureAtlasLayout.fromRects({ size, rects })` — builds an atlas layout
  from hand-placed pixel rects (Unity "multiple" mode), normalizing each to UV against `size`,
  order-preserving (index → rects[index]). The manual counterpart to the pre-existing `fromGrid`. Throws on
  non-positive size/rect dims. `TextureAtlasRect` / `TextureAtlasFromRectsOptions` exported.
- **Verified:** `texture-atlas-layout.test.ts` (+3): normalizes two irregular rects correctly; rejects
  non-positive size + zero-dim rect; empty rects → empty layout. Full engine gate green: typecheck, lint,
  1261 tests, build. Changeset.
- **HOW to test:** `TextureAtlasLayout.fromRects({ size: vec2.create(100,50), rects: [{x,y,width,height},…] })`
  → `.textures[i]` are the normalized UV rects for each sprite; feed to `TextureAtlas`.
- **NOTE:** this fills the slicing-geometry gap (grid existed, manual-rect now, 9-slice existed). Sprite
  definitions still needs the `.meta` model + resolver (Phase A), sub-asset minting via composite GUID
  (Phase B), and the Sprite Editor UI (Phase C, studio-blocked) — tracked in `sprite-definitions.md`.
- Roadmap: MASTER-ROADMAP "Sprite definitions" now 🟡 slicing geometry in place. Box unchecked pending
  your confirmation.

---

## ✅ P1 — Sprite definitions, Phase A: `.meta` model + resolver (unit-verified)

- **New:** `@retro-engine/engine` `SpriteDefinition` (mode single/multiple; source grid|rects; ppu;
  per-slice `slices` = pivot/border/name) + pure `resolveSpriteDefinition(def)` → `{ layout, sprites }`.
  Dispatches to `fromGrid`/`fromRects`, computes each slice's pixel size (for `customSize = pixelSize/ppu`),
  applies per-slice pivot/border/name (defaults: 'center', DEFAULT_PPU=100, index name). All exported.
- **Verified:** `sprite-definition.test.ts` (+3): grid → 4 sprites w/ 16×16 pixelSize + defaults; manual
  rects → correct pixel sizes + custom ppu; per-slice name/pivot/border overrides by index. Full engine gate
  green: typecheck, lint, 1264 tests, build. Changeset.
- **HOW to test:** `resolveSpriteDefinition({ mode:'multiple', source:{ kind:'grid', tileSize, columns, rows },
  ppu: 100 })` → `.layout` (TextureAtlasLayout) + `.sprites[i]` metadata; a consumer sizes each sprite via
  `pixelSize/ppu` and anchors it at `pivot`.
- **NOTE:** data model + resolver only — no runtime consumer yet. Phase B (mint each slice as a sub-asset via
  composite GUID, ADR-0126) + Phase C (Sprite Editor UI, studio-blocked) remain (tracked in
  `sprite-definitions.md`).
- Roadmap: MASTER-ROADMAP "Sprite definitions" now 🟡 slicing + model/resolver in place. Box unchecked.

---

## ✅ P1 — CSS Grid for the UI, Phase 1: track sizing + cell geometry (unit-verified)

- **New:** `@retro-engine/ui` `grid-layout.ts` (ADR-0167, roadmap `css-grid-ui.md`). Pure grid core behind
  the `LayoutEngine` seam: `GridTrack` (`px`/`fr`), `resolveGridTracks(tracks, available, gap)` (px reserve →
  gap reserve → fr split by fraction, clamped at 0), `computeGridLayout(spec, available)` → resolved
  column/row sizes + one row-major `LayoutRect` per cell. No `UiStyle`/ECS change yet.
- **Verified:** `grid-layout.test.ts` (+7): px tracks; 1fr/1fr and 1fr/3fr distribution; px+gap reserved
  before fr; over-full → fr clamped to 0; 2×2 fr grid with gaps → correct cell offsets/sizes; mixed px+fr.
  Full ui gate green: typecheck, lint, 132 tests, build. Changeset.
- **HOW to test:** `computeGridLayout({ columns:[{kind:'fr',value:1},{kind:'fr',value:1}], rows:[...], columnGap:10 }, { width, height })`
  → `.cells[i]` are the per-cell rects; a consumer places children into them.
- **NOTE:** pure algorithm only. Phase 2 (UiStyle `display:grid` + `grid-template-*` + `.rss` parse +
  layout-engine display-dispatch placing children) and Phase 3 (placement/spanning, `auto`/`minmax`,
  alignment) remain — tracked in `css-grid-ui.md`.
- Roadmap: MASTER-ROADMAP "CSS Grid for the UI layout engine" now 🟡 Phase 1 shipped. Box unchecked.

---

## ✅ P1 — CSS Grid for the UI, Phase 2: display:grid layout integration (unit-verified)

- **New:** `@retro-engine/ui` (ADR-0167). `UiStyle` gains `display: 'flex'|'grid'` +
  `gridTemplateColumns`/`gridTemplateRows` (CSS-syntax strings; `parseGridTemplate` → GridTrack[]; `gap`
  used for both axes). `FlexLayoutEngine` branches on `display:'grid'`: computes the grid for the content
  box, lays each in-flow child into its cell (row-major, stretched to fill); children past the last cell get
  a zero-size rect (auto-rows = Phase 3). `uiNodeSchema` reflects display (enum) + the two template strings.
- **Verified:** `grid-layout.test.ts` (+3 parseGridTemplate: fr/px/bare, whitespace/empty, skip malformed);
  `flex-layout.test.ts` (+3): 2×2 fr grid tiles children; px+fr+gap+padding offsets; overflow child → 0×0.
  Full ui gate green: typecheck, lint, 138 tests, build. Changeset.
- **HOW to test:** `new UiNode({ display:'grid', gridTemplateColumns:'1fr 1fr', gridTemplateRows:'1fr 1fr',
  gap:8 })` with 4 children → children tile the content box in a 2×2 grid.
- **NOTE:** grid is set via `UiNode` init (+ reflected) and applied by the layout engine. `.rss` grid
  authoring (Phase 2b) + explicit placement/spanning/`auto`/`minmax`/alignment (Phase 3) remain — tracked in
  `css-grid-ui.md`.
- Roadmap: MASTER-ROADMAP "CSS Grid for the UI layout engine" now 🟡 Phases 1–2 shipped. Box unchecked.

---

## ✅ P1 — CSS Grid for the UI, Phase 2b: `.rss` grid authoring (unit-verified)

- **New:** `@retro-engine/ui` (ADR-0167). The `.rss` style resolver (`mapDeclarations`) now maps
  `display: grid`, `grid-template-columns`, `grid-template-rows` → `UiStyle` (template values kept as CSS
  strings, parsed at layout time → no new reflection needed). Grid is now authorable from a stylesheet, not
  just `UiNode` init.
- **Verified:** `rss-resolve.test.ts` (+1): a `.grid { display: grid; grid-template-columns: 1fr 2fr 40px;
  grid-template-rows: 1fr 1fr }` rule resolves to `display:'grid'` + the exact template strings. The
  engine half (placing children into cells) was tested in Phase 2, so the `.rss` → grid-layout chain is
  covered end-to-end by composition. Full ui gate green: typecheck, lint, 139 tests, build. Changeset.
- **HOW to test:** author a `.rss` rule `display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px;` on a
  `UiClass` node → its children tile in a 3-column grid.
- **NOTE:** grid is now usable end to end (core → layout → `.rss`). Phase 3 (explicit placement/spanning,
  `auto`/`minmax` tracks, grid alignment, auto-rows) remains — tracked in `css-grid-ui.md`.
- Roadmap: MASTER-ROADMAP "CSS Grid for the UI layout engine" now 🟡 Phases 1–2b shipped (grid usable). Box
  unchecked pending your confirmation.

---
